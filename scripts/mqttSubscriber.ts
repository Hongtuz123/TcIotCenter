import { createClient } from '@supabase/supabase-js';
import mqtt from 'mqtt';
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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MQTT_URL = 'mqtt://iot.moenv.gov.tw:1883';
const CK_CODE = '7a1d3f72-315f-492a-8ee5-409da5e358ce';
const PM25_THRESHOLD = 54;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 解析執行參數 --duration <seconds>
const args = process.argv.slice(2);
const durationIndex = args.indexOf('--duration');
const duration = durationIndex !== -1 ? parseInt(args[durationIndex + 1], 10) : null;

// 在記憶體中聚合 5 分鐘時間桶
// Key 格式: "deviceId:bucketTime"
const cache = new Map<string, any>();

/** 對齊到 5 分鐘 UTC ISO 時間 */
function alignTo5Min(timeStr: string): string {
  try {
    let parsedStr = timeStr.trim();
    // 如果是 YYYY-MM-DD HH:mm:ss 這種格式，沒有帶 Z 或時區偏移，則視為台灣時間 (GMT+8)
    if (parsedStr.match(/^\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}$/)) {
      parsedStr = parsedStr.replace(/-/g, '/');
      parsedStr += ' +08:00';
    } else {
      parsedStr = parsedStr.replace(/-/g, '/');
    }

    const d = new Date(parsedStr);
    if (isNaN(d.getTime())) {
      const now = new Date();
      now.setUTCSeconds(0, 0);
      now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 5) * 5);
      return now.toISOString();
    }
    d.setUTCSeconds(0, 0);
    d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5);
    return d.toISOString();
  } catch {
    const now = new Date();
    now.setUTCSeconds(0, 0);
    now.setUTCMinutes(Math.floor(now.getUTCMinutes() / 5) * 5);
    return now.toISOString();
  }
}

async function flushCache() {
  if (cache.size === 0) {
    console.log('  快取無資料，跳過 Flush。');
    return;
  }

  const items = Array.from(cache.values());
  // 清空快取以防寫入期間收到的新資料被覆蓋
  cache.clear();

  const toUpsert = items.map((item: any) => {
    const pm25 = item.pm2_5_count > 0 ? Math.round((item.pm2_5_sum / item.pm2_5_count) * 10) / 10 : null;
    const temp = item.temp_count > 0 ? Math.round((item.temp_sum / item.temp_count) * 10) / 10 : null;
    const hum = item.hum_count > 0 ? Math.round(item.hum_sum / item.hum_count) : null;

    const isAnomaly = pm25 != null && pm25 >= PM25_THRESHOLD;
    const anomalyType = isAnomaly
      ? pm25 >= 150
        ? '嚴重污染'
        : pm25 >= 54
        ? 'PM₂.₅超標'
        : ''
      : null;

    return {
      station_id: item.station_id,
      bucket_time: item.bucket_time,
      pm2_5: pm25,
      temperature: temp,
      humidity: hum,
      pm25_samples: item.pm2_5_count,
      temp_samples: item.temp_count,
      hum_samples: item.hum_count,
      is_anomaly: isAnomaly,
      anomaly_type: anomalyType,
    };
  });

  console.log(`💾 準備 Upsert ${toUpsert.length} 筆資料至 observations_5m...`);

  // 分批寫入 (每批 300 筆)
  const batchSize = 300;
  let successCount = 0;
  for (let i = 0; i < toUpsert.length; i += batchSize) {
    const batch = toUpsert.slice(i, i + batchSize);
    const { error } = await supabase
      .from('observations_5m')
      .upsert(batch, {
        onConflict: 'station_id,bucket_time',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`❌ 寫入 observations_5m 失敗 (批次引 ${i}):`, error.message);
    } else {
      successCount += batch.length;
    }
  }

  console.log(`✅ 成功 Upsert ${successCount} / ${toUpsert.length} 筆觀測資料`);
}

function run() {
  console.log(`🔌 連線至 MQTT 伺服器: ${MQTT_URL}...`);
  
  const client = mqtt.connect(MQTT_URL, {
    username: CK_CODE,
    password: CK_CODE,
    clientId: `mqtt-subscriber-${Math.random().toString(16).substring(2, 10)}`,
  });

  client.on('connect', () => {
    console.log('✅ MQTT 連線成功！');
    // 訂閱專案 22 (台中市) 的所有裝置資料
    const topicPattern = '/v1/project/22/device/+/sensor/+/rawdata';
    client.subscribe(topicPattern, (err) => {
      if (err) {
        console.error('❌ 訂閱主題失敗:', err);
        process.exit(1);
      }
      console.log(`📡 訂閱主題成功: ${topicPattern}`);
    });
  });

  client.on('message', (topic, message) => {
    try {
      // 解析 Topic 格式: /v1/project/22/device/{deviceId}/sensor/{sensorId}/rawdata
      const match = topic.match(/^\/v1\/project\/22\/device\/([^/]+)\/sensor\/([^/]+)\/rawdata$/);
      if (!match) return;

      const deviceId = match[1];
      const sensorId = match[2];

      const payload = JSON.parse(message.toString());
      const rawVal = parseFloat(payload.value?.[0]);
      
      if (isNaN(rawVal)) return;

      // 異常大值/負值過濾
      if (sensorId === 'pm2_5' && (rawVal < 0 || rawVal > 500)) return;
      if (sensorId === 'temperature' && (rawVal < -10 || rawVal > 60)) return;
      if (sensorId === 'humidity' && (rawVal < 0 || rawVal > 100)) return;

      const bucketTime = alignTo5Min(payload.time || new Date().toISOString());
      const key = `${deviceId}:${bucketTime}`;

      let entry = cache.get(key);
      if (!entry) {
        entry = {
          station_id: deviceId,
          bucket_time: bucketTime,
          pm2_5_sum: 0,
          pm2_5_count: 0,
          temp_sum: 0,
          temp_count: 0,
          hum_sum: 0,
          hum_count: 0,
        };
        cache.set(key, entry);
      }

      if (sensorId === 'pm2_5') {
        entry.pm2_5_sum += rawVal;
        entry.pm2_5_count++;
      } else if (sensorId === 'temperature') {
        entry.temp_sum += rawVal;
        entry.temp_count++;
      } else if (sensorId === 'humidity') {
        entry.hum_sum += rawVal;
        entry.hum_count++;
      }
    } catch (e: any) {
      console.error('⚠️ 訊息解析錯誤:', e.message);
    }
  });

  // 若設定了執行時間 (例如 GitHub Actions 限制)，到期自動關閉
  if (duration && duration > 0) {
    console.log(`⏱️ 設定限時執行: ${duration} 秒，時間到後將自動退出並寫入資料庫...`);
    // 限時執行模式下：不使用定時 Flush，避免 30 秒清空 Cache 造成 upsert 欄位覆蓋
    setTimeout(async () => {
      console.log('⏱️ 執行時間結束。開始進行最後的資料寫入...');
      client.end();
      await flushCache();
      console.log('👋 訂閱器安全退出。');
      process.exit(0);
    }, duration * 1000);
  } else {
    // 長連線模式下：改用 5 分鐘大週期 Flush，以減少 upsert 覆蓋機率
    setInterval(flushCache, 300000);
  }
}

run();
