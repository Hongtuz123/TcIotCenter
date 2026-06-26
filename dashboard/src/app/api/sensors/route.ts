import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { mockSensors } from '@/lib/mockData';
import { getDb } from '@/lib/db';

/** 分頁抓取 Supabase，突破 max_rows 設定限制 */
async function fetchAllSensors() {
  if (!supabase) return [];
  const PAGE = 1000;
  let allData: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('sensors')
      .select('station_id,device_name,lat,lon,city,township,area,area_type')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < PAGE) break; // 最後一頁
    from += PAGE;
  }
  return allData;
}

/** 分頁抓取最近 1 小時觀測值 */
async function fetchLatestObs(oneHourAgo: string) {
  if (!supabase) return {};
  const PAGE = 1000;
  let latestObs: Record<string, any> = {};
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('observations_5m')
      .select('station_id,bucket_time,pm2_5,temperature,humidity,is_anomaly,anomaly_type')
      .gte('bucket_time', oneHourAgo)
      .order('bucket_time', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const obs of data) {
      if (!latestObs[obs.station_id]) latestObs[obs.station_id] = obs;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return latestObs;
}

export async function GET() {
  try {
    // ── Tier 1: Supabase ──────────────────────────────────────────────────────
    if (supabase) {
      // 分頁抓取全部測站
      const data = await fetchAllSensors();

      // 分頁抓取最近 1 小時觀測值
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const latestObs = await fetchLatestObs(oneHourAgo);

      // 合併 sensor + observation
      const sensors = data.map((s: any) => ({
        id: s.station_id,
        name: s.device_name,
        lat: s.lat,
        lon: s.lon,
        county: s.township || s.city,
        area: s.area || null,
        areaType: s.area_type || null,
        status: '正常',
        pm2_5: latestObs[s.station_id]?.pm2_5 ?? null,
        temperature: latestObs[s.station_id]?.temperature ?? null,
        humidity: latestObs[s.station_id]?.humidity ?? null,
        isAnomaly: latestObs[s.station_id]?.is_anomaly ?? false,
        anomalyType: latestObs[s.station_id]?.anomaly_type ?? '',
        lastUpdate: latestObs[s.station_id]?.bucket_time ?? null,
      }));

      return NextResponse.json(sensors);
    }

    // ── Tier 2: SQLite ────────────────────────────────────────────────────────
    const db = await getDb();
    if (db) {
      const sensors = await db.all('SELECT * FROM sensors');
      return NextResponse.json(sensors);
    }

    // ── Tier 3: Mock ──────────────────────────────────────────────────────────
    return NextResponse.json(mockSensors);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
