/**
 * IoT 爬蟲腳本：從 OGC SensorThings API 抓取台中市微感測站資料
 * 聚合為 5 分鐘均值後 upsert 至 Supabase
 *
 * 執行方式：npx tsx scripts/pollIoT.ts
 * 環境變數：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// ---- 載入鄰近的 .env.local 環境變數 ----
try {
  const envPath = path.join(__dirname, '../dashboard/.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let value = match[2] ? match[2].trim() : '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
    });
  }
} catch (e: any) {
  console.warn('⚠️ 無法載入 .env.local:', e.message);
}

// ---- 環境變數 ----
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STA_BASE = 'https://sta.colife.org.tw/STA_AirQuality_EPAIoT/v1.0';
const CITY_FILTER = "properties/city eq '臺中市'";
const PAGE_SIZE = 200; // API 每頁筆數（加大減少分頁次數）

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- 型別定義 ----
interface StaThing {
  name: string;
  properties: {
    stationID: string;
    deviceName: string;
    city: string;
    township?: string;
    area?: string;
    areaType?: string;
  };
  Locations: {
    location: {
      type: string;
      coordinates: [number, number]; // [lon, lat]
    };
  }[];
}

interface StaDatastream {
  'Thing': {
    properties: { stationID: string };
  };
  'Observations': {
    phenomenonTime: string;
    result: number;
  }[];
}

// ---- 工具函數 ----

/** 對齊到 5 分鐘桶 */
function alignTo5Min(isoTime: string): string {
  const d = new Date(isoTime);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5);
  return d.toISOString();
}

/** 分頁抓取 STA API */
async function fetchAllPages<T>(url: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  let page = 0;

  while (nextUrl) {
    page++;
    console.log(`  頁 ${page}: ${nextUrl.substring(0, 80)}...`);
    const res = await fetch(nextUrl);
    if (!res.ok) {
      console.error(`  ❌ HTTP ${res.status} - ${await res.text()}`);
      break;
    }
    const json = await res.json();
    results.push(...(json.value || []));
    nextUrl = json['@iot.nextLink'] || null;

    // 避免觸發 rate limit
    if (nextUrl) await sleep(300);
  }
  return results;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Phase 1: 同步測站基本資料（只在每天 UTC 00:xx 執行一次，其餘時間讀 Supabase 快取）----
async function syncSensors(force = false): Promise<Map<string, StaThing['properties']>> {
  const nowHour = new Date().getUTCHours();
  const shouldFetchFromAPI = force || nowHour === 0;

  if (!shouldFetchFromAPI) {
    // 非每日同步時段 → 分頁讀取 Supabase 快取（突破 max_rows 1000 限制）
    console.log('\n📡 Phase 1: 從 Supabase 讀取測站快取（非每日同步時段）...');
    const propMap = new Map<string, StaThing['properties']>();
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('sensors')
        .select('station_id,device_name,city,township,area,area_type')
        .range(from, from + 999);
      if (error) { console.error('  sensors 快取讀取失敗:', error.message); break; }
      if (!data || data.length === 0) break;
      data.forEach((row: any) =>
        propMap.set(row.station_id, {
          stationID: row.station_id,
          deviceName: row.device_name,
          city: row.city,
          township: row.township,
          area: row.area,
          areaType: row.area_type,
        })
      );
      if (data.length < 1000) break;
      from += 1000;
    }
    console.log(`  ✅ 快取讀取 ${propMap.size} 站`);
    return propMap;
  }

  // 每日同步時段 → 從 STA API 抓取最新測站清單
  console.log('\n📡 Phase 1: 從 STA API 同步台中市測站清單...');
  const url = `${STA_BASE}/Things?$expand=Locations&$select=name,properties&$filter=${encodeURIComponent(CITY_FILTER)}&$top=${PAGE_SIZE}`;
  const things = await fetchAllPages<StaThing>(url);

  console.log(`  共抓到 ${things.length} 個台中測站`);

  const sensorsToUpsert = things
    .filter((t) => t.Locations?.[0]?.location?.coordinates)
    .map((t) => {
      const [lon, lat] = t.Locations[0].location.coordinates;
      return {
        station_id: t.properties.stationID,
        device_name: t.properties.deviceName,
        lat,
        lon,
        city: t.properties.city,
        township: t.properties.township || null,
        area: t.properties.area || null,
        area_type: t.properties.areaType || null,
      };
    });

  // 批次 upsert (每次 500 筆)
  for (let i = 0; i < sensorsToUpsert.length; i += 500) {
    const batch = sensorsToUpsert.slice(i, i + 500);
    const { error } = await supabase
      .from('sensors')
      .upsert(batch, { onConflict: 'station_id', ignoreDuplicates: false });
    if (error) console.error('  sensors upsert error:', error.message);
  }

  console.log(`  ✅ sensors 表已更新 ${sensorsToUpsert.length} 筆`);

  // 回傳 stationID → properties 的 Map
  const propMap = new Map<string, StaThing['properties']>();
  things.forEach((t) => propMap.set(t.properties.stationID, t.properties));
  return propMap;
}

// ---- Phase 2: 抓最新觀測值並聚合 ----
async function fetchLatestObservations(metric: string): Promise<Map<string, { time: string; value: number }>> {
  console.log(`\n📥 抓取最新 ${metric} 觀測值...`);

  // 用 Things filter 限縮台中，再透過 Datastream name filter
  const url =
    `${STA_BASE}/Datastreams` +
    `?$expand=Thing,Observations($orderby=phenomenonTime%20desc;$top=1)` +
    `&$filter=${encodeURIComponent(`name eq '${metric}' and Thing/` + CITY_FILTER)}` +
    `&$top=${PAGE_SIZE}`;

  const datastreams = await fetchAllPages<StaDatastream>(url);
  console.log(`  收到 ${datastreams.length} 個 ${metric} Datastream`);

  const result = new Map<string, { time: string; value: number }>();
  for (const ds of datastreams) {
    const stationId = ds.Thing?.properties?.stationID;
    const obs = ds.Observations?.[0];
    if (stationId && obs && obs.result != null) {
      result.set(stationId, {
        time: obs.phenomenonTime,
        value: obs.result,
      });
    }
  }
  return result;
}

// ---- Phase 3: 聚合並 upsert observations_5m ----
async function upsertObservations(
  pm25Map: Map<string, { time: string; value: number }>,
  tempMap: Map<string, { time: string; value: number }>,
  humMap: Map<string, { time: string; value: number }>,
  pm25Threshold: number = 54
) {
  console.log('\n💾 Phase 3: 聚合寫入 observations_5m...');

  // 蒐集所有有資料的 stationId
  const allStations = new Set([
    ...pm25Map.keys(),
    ...tempMap.keys(),
    ...humMap.keys(),
  ]);

  const toUpsert: Record<string, unknown>[] = [];

  for (const stationId of allStations) {
    const pm25Entry = pm25Map.get(stationId);
    const tempEntry = tempMap.get(stationId);
    const humEntry = humMap.get(stationId);

    // 以 PM2.5 時間為主，無 PM2.5 用溫度或濕度時間
    const refTime = pm25Entry?.time || tempEntry?.time || humEntry?.time;
    if (!refTime) continue;

    const bucketTime = alignTo5Min(refTime);

    const pm25 = pm25Entry?.value ?? null;
    const isAnomaly = pm25 != null && pm25 >= pm25Threshold;
    const anomalyType = isAnomaly
      ? pm25 >= 150
        ? '嚴重污染'
        : pm25 >= 54
        ? 'PM₂.₅超標'
        : ''
      : null;

    toUpsert.push({
      station_id: stationId,
      bucket_time: bucketTime,
      pm2_5: pm25 != null ? Math.round(pm25 * 10) / 10 : null,
      temperature: tempEntry?.value != null ? Math.round(tempEntry.value * 10) / 10 : null,
      humidity: humEntry?.value != null ? Math.round(humEntry.value) : null,
      pm25_samples: pm25Entry ? 1 : 0,
      temp_samples: tempEntry ? 1 : 0,
      hum_samples: humEntry ? 1 : 0,
      is_anomaly: isAnomaly,
      anomaly_type: anomalyType,
    });
  }

  // 批次 upsert
  let successCount = 0;
  for (let i = 0; i < toUpsert.length; i += 500) {
    const batch = toUpsert.slice(i, i + 500);
    const { error } = await supabase
      .from('observations_5m')
      .upsert(batch, {
        onConflict: 'station_id,bucket_time',
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(`  observations upsert error (batch ${i}):`, error.message);
    } else {
      successCount += batch.length;
    }
  }

  console.log(`  ✅ upsert ${successCount} / ${toUpsert.length} 筆`);
  return { total: toUpsert.length, success: successCount };
}

// ---- Phase 4: 計算並記錄完整率 ----
async function logCompleteness(
  windowMinutes: number = 60,
  totalSensors: number,
  actualObs: number
) {
  console.log('\n📊 Phase 4: 記錄完整率...');

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  // 計算這個視窗內實際有資料的 (station_id, bucket_time) 組合數
  const { count, error } = await supabase
    .from('observations_5m')
    .select('*', { count: 'exact', head: true })
    .gte('bucket_time', windowStart.toISOString())
    .lte('bucket_time', now.toISOString());

  if (error) {
    console.error('  completeness count error:', error.message);
    return;
  }

  const actualCount = count || 0;
  const expectedCount = totalSensors * (windowMinutes / 5); // 1418 × 12 = 17016
  const rate = actualCount / expectedCount;

  await supabase.from('completeness_log').insert({
    window_start: windowStart.toISOString(),
    window_end: now.toISOString(),
    total_sensors: totalSensors,
    expected_obs: expectedCount,
    actual_obs: actualCount,
    completeness_rate: Math.min(rate, 1.0),
    offline_count: Math.max(0, totalSensors - Math.round(actualCount / (windowMinutes / 5))),
  });

  console.log(
    `  ✅ 完整率: ${(rate * 100).toFixed(1)}%  (實際 ${actualCount} / 預期 ${expectedCount})`
  );
}

// ---- Phase 5: 清理舊資料 ----
async function cleanup() {
  console.log('\n🗑️  Phase 5: 清理 7 天前舊資料...');
  const { error } = await supabase.rpc('cleanup_old_observations');
  if (error) {
    // RPC 可能未建立，改用直接 delete
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('observations_5m').delete().lt('bucket_time', cutoff);
    console.log('  ✅ 已清理舊資料（direct delete）');
  } else {
    console.log('  ✅ 已清理舊資料（via RPC）');
  }
}

// ---- Main ----
async function main() {
  const startTime = Date.now();
  console.log(`\n🚀 IoT Poller 啟動 - ${new Date().toISOString()}`);
  console.log('   目標：台中市微感測站即時資料');

  try {
    // Phase 1: 測站同步
    const propMap = await syncSensors();
    const totalSensors = propMap.size;

    // Phase 2: 並行抓三個指標
    const [pm25Map, tempMap, humMap] = await Promise.all([
      fetchLatestObservations('PM2.5'),
      fetchLatestObservations('Temperature'),
      fetchLatestObservations('Relative humidity'),
    ]);

    // Phase 3: 聚合寫入
    const { total, success } = await upsertObservations(pm25Map, tempMap, humMap);

    // Phase 4: 完整率
    await logCompleteness(60, totalSensors, success);

    // Phase 5: 清理
    await cleanup();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ 完成！耗時 ${elapsed}s，處理 ${total} 站資料`);
  } catch (err) {
    console.error('\n❌ Poller 執行失敗:', err);
    process.exit(1);
  }
}

main();
