const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ---- 載入環境變數 ----
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkData() {
  console.log('📡 正在從 Supabase 讀取最近的觀測資料...');

  const { data: obs, error } = await supabase
    .from('observations_5m')
    .select('pm2_5, temperature, humidity, is_anomaly, anomaly_type, bucket_time')
    .order('bucket_time', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('❌ 讀取失敗:', error.message);
    return;
  }

  if (!obs || obs.length === 0) {
    console.log('ℹ️ 目前沒有任何觀測資料。');
    return;
  }

  console.log(`✅ 成功獲取 ${obs.length} 筆最近的觀測資料。`);
  console.log(`時間範圍: ${obs[obs.length - 1].bucket_time} 至 ${obs[0].bucket_time}`);

  let pm25List = obs.map(o => o.pm2_5).filter(v => v !== null);
  let tempList = obs.map(o => o.temperature).filter(v => v !== null);
  let humidList = obs.map(o => o.humidity).filter(v => v !== null);
  let anomalyCount = obs.filter(o => o.is_anomaly).length;

  const stats = (list) => {
    if (list.length === 0) return { min: 0, max: 0, avg: 0 };
    const min = Math.min(...list);
    const max = Math.max(...list);
    const avg = list.reduce((a, b) => a + b, 0) / list.length;
    return { min, max, avg };
  };

  const pm25Stats = stats(pm25List);
  const tempStats = stats(tempList);
  const humidStats = stats(humidList);

  console.log('\n📊 觀測值統計結果 (最近 1000 筆)：');
  console.log(`PM2.5  -> 最小值: ${pm25Stats.min.toFixed(2)}, 最大值: ${pm25Stats.max.toFixed(2)}, 平均值: ${pm25Stats.avg.toFixed(2)} ug/m³`);
  console.log(`溫度   -> 最小值: ${tempStats.min.toFixed(2)}, 最大值: ${tempStats.max.toFixed(2)}, 平均值: ${tempStats.avg.toFixed(2)} °C`);
  console.log(`濕度   -> 最小值: ${humidStats.min.toFixed(2)}, 最大值: ${humidStats.max.toFixed(2)}, 平均值: ${humidStats.avg.toFixed(2)} %`);

  console.log(`\n🚨 異常狀態統計：`);
  console.log(`標記為異常 (is_anomaly = true) 的筆數: ${anomalyCount} 筆 (${((anomalyCount / obs.length) * 100).toFixed(2)}%)`);

  const anomalyTypes = obs.filter(o => o.is_anomaly).map(o => o.anomaly_type);
  const typeCounts = anomalyTypes.reduce((acc, t) => {
    acc[t || '未定義'] = (acc[t || '未定義'] || 0) + 1;
    return acc;
  }, {});
  console.log('異常類型分佈:', typeCounts);

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('*');

  if (settingsError) {
    console.log('ℹ&nbsp;settings 表讀取失敗:', settingsError.message);
  } else {
    console.log('\n⚙️ 目前 Supabase 中的設定值：');
    console.log(settings);
  }
}

checkData();
