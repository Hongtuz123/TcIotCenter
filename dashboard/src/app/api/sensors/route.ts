import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { mockSensors } from '@/lib/mockData';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    // ── Tier 1: Supabase ──────────────────────────────────────────────────────
    if (supabase) {
      // 取得所有台中測站 + 最新一筆觀測值（subquery 取最新 bucket_time）
      const { data, error } = await supabase
        .from('sensors')
        .select(`
          station_id,
          device_name,
          lat,
          lon,
          city,
          township,
          area,
          area_type
        `);

      if (error) throw error;

      // 批次取各站最新觀測值
      const stationIds = (data || []).map((s: any) => s.station_id);
      let latestObs: Record<string, any> = {};

      if (stationIds.length > 0) {
        // 使用 DISTINCT ON 策略：取每站最新 bucket_time 的資料
        const { data: obsData } = await supabase
          .from('observations_5m')
          .select('station_id, bucket_time, pm2_5, temperature, humidity, is_anomaly, anomaly_type')
          .in('station_id', stationIds)
          .order('bucket_time', { ascending: false })
          .limit(stationIds.length * 2); // 每站取最新 2 筆，客戶端 dedup

        if (obsData) {
          // 每站只保留最新一筆
          for (const obs of obsData) {
            if (!latestObs[obs.station_id]) {
              latestObs[obs.station_id] = obs;
            }
          }
        }
      }

      // 合併 sensor + observation
      const sensors = (data || []).map((s: any) => ({
        id: s.station_id,
        name: s.device_name,
        lat: s.lat,
        lon: s.lon,
        county: s.township || s.city,
        area: s.area || null,
        areaType: s.area_type || null,
        status: '正常',
        // 最新觀測值
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
