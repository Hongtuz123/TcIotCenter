-- =============================================
-- 臺中市微感測站 IoT 資料庫 Schema
-- 在 Supabase SQL Editor 執行此檔案
-- =============================================

-- 啟用 pg_trgm 擴充（用於模糊搜尋）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- 1. 測站基本資料表
-- =============================================
CREATE TABLE IF NOT EXISTS sensors (
  station_id    TEXT PRIMARY KEY,          -- 環境部 stationID
  device_name   TEXT NOT NULL,             -- 設備名稱 (如 TC0062)
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  city          TEXT NOT NULL DEFAULT '臺中市',
  township      TEXT,                       -- 行政區 (如 北屯區)
  area          TEXT,                       -- 工業區名稱
  area_type     TEXT,                       -- areaType (工業區 / 一般)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 2. 5 分鐘聚合觀測值表
-- =============================================
CREATE TABLE IF NOT EXISTS observations_5m (
  id              BIGSERIAL PRIMARY KEY,
  station_id      TEXT NOT NULL REFERENCES sensors(station_id) ON DELETE CASCADE,
  bucket_time     TIMESTAMPTZ NOT NULL,    -- 對齊到 5 分鐘 (e.g. 10:05:00, 10:10:00)
  pm2_5           DOUBLE PRECISION,        -- 平均 PM2.5 (μg/m³)
  temperature     DOUBLE PRECISION,        -- 平均溫度 (°C)
  humidity        DOUBLE PRECISION,        -- 平均相對濕度 (%)
  pm25_samples    SMALLINT DEFAULT 0,      -- PM2.5 樣本數 (完整率用)
  temp_samples    SMALLINT DEFAULT 0,      -- 溫度樣本數
  hum_samples     SMALLINT DEFAULT 0,      -- 濕度樣本數
  is_anomaly      BOOLEAN DEFAULT FALSE,   -- 是否異常
  anomaly_type    TEXT,                    -- 異常類型說明
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 唯一索引：同一站同一時間桶只保留一筆（upsert 用）
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs5m_station_bucket
  ON observations_5m (station_id, bucket_time);

-- 時間索引（查詢最新資料 / 時間範圍）
CREATE INDEX IF NOT EXISTS idx_obs5m_bucket_time
  ON observations_5m (bucket_time DESC);

-- 站 + 時間複合索引（單站歷史查詢）
CREATE INDEX IF NOT EXISTS idx_obs5m_station_time
  ON observations_5m (station_id, bucket_time DESC);

-- =============================================
-- 3. 完整率快照表（每小時計算一次）
-- =============================================
CREATE TABLE IF NOT EXISTS completeness_log (
  id              BIGSERIAL PRIMARY KEY,
  snapshot_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_start    TIMESTAMPTZ NOT NULL,    -- 計算視窗開始
  window_end      TIMESTAMPTZ NOT NULL,    -- 計算視窗結束
  total_sensors   INT NOT NULL,            -- 當時台中總站數
  expected_obs    INT NOT NULL,            -- 預期筆數 (total_sensors × 12)
  actual_obs      INT NOT NULL,            -- 實際有資料的站點×時間點
  completeness_rate DOUBLE PRECISION NOT NULL, -- 0.0 ~ 1.0
  offline_count   INT DEFAULT 0            -- 連續無資料的站數
);

-- =============================================
-- 4. Row Level Security
-- =============================================
ALTER TABLE sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations_5m ENABLE ROW LEVEL SECURITY;
ALTER TABLE completeness_log ENABLE ROW LEVEL SECURITY;

-- anon 可讀（前端直接查或走 API Route 都行）
CREATE POLICY "anon_read_sensors" ON sensors
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_obs5m" ON observations_5m
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_completeness" ON completeness_log
  FOR SELECT TO anon USING (true);

-- service_role 可寫（爬蟲 upsert 用）
CREATE POLICY "service_write_sensors" ON sensors
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_write_obs5m" ON observations_5m
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_write_completeness" ON completeness_log
  FOR ALL TO service_role USING (true);

-- =============================================
-- 5. 自動更新 updated_at trigger
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sensors_updated_at
  BEFORE UPDATE ON sensors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 6. 自動清理 7 天前舊資料的 function
-- =============================================
CREATE OR REPLACE FUNCTION cleanup_old_observations()
RETURNS void AS $$
BEGIN
  DELETE FROM observations_5m
  WHERE bucket_time < NOW() - INTERVAL '7 days';

  DELETE FROM completeness_log
  WHERE snapshot_time < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
