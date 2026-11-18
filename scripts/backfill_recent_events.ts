/// <reference types="node" />
/**
 * 以 6 小時時間切片高速掃描近 7 天 observations_5m，補建 11 月群聚異常事件（台北時間格式）
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.join(__dirname, '../dashboard/.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split(/\r?\n/).forEach((line: string) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] ? match[2].trim() : '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  });
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toTaipeiStr(isoStr: string): string {
  const d = new Date(isoStr);
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:00`;
}

async function main() {
  // 清理剛才帶有 UTC +00:00 格式的測試事件
  await supabase.from('events').delete().like('id', 'auto_202611180040_%');

  const { data: setRows } = await supabase.from('settings').select('*');
  const setObj: Record<string, number> = {};
  (setRows || []).forEach((r: any) => {
    setObj[r.key] = parseFloat(r.value);
  });
  const pm25Thresh = setObj.pm25_threshold ?? 50.4;
  const consecutiveExceeds = Math.round(setObj.consecutive_exceeds ?? 3);
  const clusterRadiusKm = setObj.cluster_radius_km ?? 1.0;
  const minClusterStations = Math.round(setObj.min_cluster_stations ?? 2);

  console.log(`📋 目前設定: PM2.5 >= ${pm25Thresh}, 連續 ${consecutiveExceeds} 筆, 半徑 ${clusterRadiusKm} km, 最少 ${minClusterStations} 站`);

  const sensorMap = new Map<string, { name: string; lat: number; lon: number }>();
  let sFrom = 0;
  while (true) {
    const { data } = await supabase.from('sensors').select('station_id,device_name,lat,lon').range(sFrom, sFrom + 999);
    if (!data || data.length === 0) break;
    data.forEach((s: any) => {
      if (s.lat && s.lon) sensorMap.set(s.station_id, { name: s.device_name || s.station_id, lat: s.lat, lon: s.lon });
    });
    if (data.length < 1000) break;
    sFrom += 1000;
  }

  // 以 6 小時為切片，掃描最近 7 天有 is_anomaly=true 的資料（利用索引避免 Timeout）
  const now = Date.now();
  const start7d = now - 7 * 24 * 60 * 60 * 1000;
  const stepMs = 6 * 60 * 60 * 1000;
  const exceedRows: { station_id: string; bucket_time: string; pm2_5: number }[] = [];

  for (let t = start7d; t < now; t += stepMs) {
    const tStart = new Date(t).toISOString();
    const tEnd = new Date(Math.min(t + stepMs, now)).toISOString();
    const { data, error } = await supabase
      .from('observations_5m')
      .select('station_id,bucket_time,pm2_5')
      .gte('bucket_time', tStart)
      .lt('bucket_time', tEnd)
      .eq('is_anomaly', true)
      .limit(5000);
    if (!error && data && data.length > 0) {
      for (const r of data) {
        if (r.pm2_5 != null && r.pm2_5 >= pm25Thresh) {
          exceedRows.push(r);
        }
      }
    }
  }

  console.log(`🔍 近 7 天共撈出 ${exceedRows.length} 筆超標觀測紀錄 (PM2.5 >= ${pm25Thresh})`);

  const byStation = new Map<string, { ts: number; timeStr: string; pm2_5: number }[]>();
  for (const r of exceedRows) {
    const ts = new Date(r.bucket_time).getTime();
    if (!byStation.has(r.station_id)) byStation.set(r.station_id, []);
    byStation.get(r.station_id)!.push({ ts, timeStr: r.bucket_time, pm2_5: r.pm2_5 });
  }

  const timeBuckets = new Map<string, { id: string; lat: number; lon: number; pm2_5: number }[]>();
  for (const [stationId, list] of byStation.entries()) {
    list.sort((a, b) => a.ts - b.ts);
    const sensor = sensorMap.get(stationId);
    if (!sensor) continue;
    let streak = 0;
    let prevTs = 0;
    for (const item of list) {
      if (prevTs > 0 && item.ts - prevTs === 0) continue;
      if (prevTs > 0 && item.ts - prevTs <= 10 * 60 * 1000) {
        streak++;
      } else {
        streak = 1;
      }
      prevTs = item.ts;
      if (streak >= consecutiveExceeds) {
        if (!timeBuckets.has(item.timeStr)) timeBuckets.set(item.timeStr, []);
        timeBuckets.get(item.timeStr)!.push({
          id: stationId,
          lat: sensor.lat,
          lon: sensor.lon,
          pm2_5: item.pm2_5,
        });
      }
    }
  }

  const recentClusterCenters: { ts: number; lat: number; lon: number }[] = [];
  const sortedTimes = Array.from(timeBuckets.keys()).sort();
  let createdTotal = 0;

  for (const isoTimeStr of sortedTimes) {
    const pts = timeBuckets.get(isoTimeStr)!;
    if (pts.length < minClusterStations) continue;

    const visited = new Set<string>();
    const ts = new Date(isoTimeStr).getTime();

    for (const seed of pts) {
      if (visited.has(seed.id)) continue;
      const group = pts.filter((o) => getDistanceKm(seed.lat, seed.lon, o.lat, o.lon) <= clusterRadiusKm);
      if (group.length >= minClusterStations) {
        group.forEach((p) => visited.add(p.id));
        const avgLat = group.reduce((s, p) => s + p.lat, 0) / group.length;
        const avgLon = group.reduce((s, p) => s + p.lon, 0) / group.length;
        const avgPm25 = group.reduce((s, p) => s + p.pm2_5, 0) / group.length;

        // 同區域 3 小時內去重
        const isDuplicate = recentClusterCenters.some(
          (c) => Math.abs(ts - c.ts) <= 3 * 60 * 60 * 1000 && getDistanceKm(avgLat, avgLon, c.lat, c.lon) <= 3.0
        );
        if (isDuplicate) continue;
        recentClusterCenters.push({ ts, lat: avgLat, lon: avgLon });

        const taipeiTime = toTaipeiStr(isoTimeStr);
        const fmtTime = taipeiTime.replace(/[- :T]/g, '').substring(0, 12);
        const eventId = `auto_${fmtTime}_${avgLat.toFixed(3)}_${avgLon.toFixed(3)}`;
        const dominantType = `連續 ${consecutiveExceeds} 筆 PM₂.₅ 超標`;

        const { error } = await supabase.from('events').upsert(
          {
            id: eventId,
            title: `微感事件`,
            description: `系統自動偵測超標群聚熱區。超標站數：${group.length} 站，平均 PM₂.₅ 濃度：${avgPm25.toFixed(1)} µg/m³，主導類型：${dominantType}。`,
            status: '待確認',
            created_at: taipeiTime,
            updated_at: taipeiTime,
            bounds: JSON.stringify({
              center: { lat: avgLat, lng: avgLon },
              radiusKm: clusterRadiusKm,
              pm25Threshold: pm25Thresh,
              consecutiveExceeds,
            }),
            event_time: taipeiTime,
            stations_count: group.length,
            avg_pm25: avgPm25,
            dominant_type: dominantType,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
        if (!error) createdTotal++;
      }
    }
  }

  console.log(`🎉 補建完成！共寫入 ${createdTotal} 筆 11 月份群聚超標事件。`);

  const { data: latestEvents } = await supabase
    .from('events')
    .select('id,title,event_time,stations_count,avg_pm25')
    .order('event_time', { ascending: false })
    .limit(10);
  console.log('📊 目前最新 10 筆事件:', latestEvents);
}

main();
