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

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CSV_PATH = path.join(__dirname, '../iotinformation.csv');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function cleanValue(val: string | undefined): string | null {
  if (!val) return null;
  const clean = val.replace(/"/g, '').trim();
  return clean === '無' || clean === '' ? null : clean;
}

async function run() {
  console.log('🚀 開始初始化專案 22 (台中市) 測站基本資料...');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ 找不到感測器資訊檔: ${CSV_PATH}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = csvContent.split(/\r?\n/);
  
  const sensorsToUpsert: any[] = [];
  
  // 第一行是 header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 解析 CSV 行 (處理帶雙引號與逗號)
    // 格式: "ID","專案","名稱","緯度","經度","區域","區域類型","行政區","裝置類型","資料種類"
    const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 5) continue;

    const deviceId = parts[0];
    const projectId = parts[1];
    const deviceName = parts[2];
    const latStr = parts[3];
    const lonStr = parts[4];
    const area = cleanValue(parts[5]);
    const areaType = cleanValue(parts[6]);
    const township = cleanValue(parts[7]);

    // 只匯入專案 22 (台中地區)
    if (projectId !== '22') continue;

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) continue;

    sensorsToUpsert.push({
      station_id: deviceId,
      device_name: deviceName,
      lat,
      lon,
      city: '臺中市',
      township: township,
      area: area,
      area_type: areaType,
    });
  }

  console.log(`📡 準備匯入 ${sensorsToUpsert.length} 筆測站至 Supabase...`);

  // 分批寫入 (每批 300 筆)
  const batchSize = 300;
  let successCount = 0;

  for (let i = 0; i < sensorsToUpsert.length; i += batchSize) {
    const batch = sensorsToUpsert.slice(i, i + batchSize);
    const { error } = await supabase
      .from('sensors')
      .upsert(batch, { onConflict: 'station_id', ignoreDuplicates: false });

    if (error) {
      console.error(`❌ 批次匯入失敗 (索引 ${i}):`, error.message);
    } else {
      successCount += batch.length;
      console.log(`  已完成: ${successCount} / ${sensorsToUpsert.length}`);
    }
  }

  console.log('✅ 測站基本資料初始化完成！');
}

run().catch(err => {
  console.error('❌ 執行發生錯誤:', err);
  process.exit(1);
});
