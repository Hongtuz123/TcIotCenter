import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { getMockHistory } from '@/lib/mockData';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sensorId = searchParams.get('sensorId');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const limit = Math.min(parseInt(searchParams.get('limit') || '288', 10), 2000);

    // ── Tier 1: Supabase ──────────────────────────────────────────────────────
    if (supabase) {
      let query = supabase
        .from('observations_5m')
        .select('station_id, bucket_time, pm2_5, temperature, humidity, is_anomaly, anomaly_type')
        .order('bucket_time', { ascending: true })
        .limit(limit);

      if (sensorId) query = query.eq('station_id', sensorId);

      // 預設查最近 24 小時
      const defaultStart = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const defaultEnd = endTime || new Date().toISOString();

      query = query
        .gte('bucket_time', defaultStart)
        .lte('bucket_time', defaultEnd);

      const { data, error } = await query;
      if (error) throw error;

      // 轉換為前端期望格式
      const observations = (data || []).map((row: any) => ({
        sensor_id: row.station_id,
        time: row.bucket_time,
        pm2_5: row.pm2_5,
        temperature: row.temperature,
        humidity: row.humidity,
        voc: null, // STA API 目前無 VOC
        isAnomaly: row.is_anomaly,
        anomalyType: row.anomaly_type,
      }));

      return NextResponse.json(observations);
    }

    // ── Tier 2: SQLite ────────────────────────────────────────────────────────
    const db = await getDb();
    if (db) {
      let query = 'SELECT * FROM observations WHERE 1=1';
      const params: any[] = [];
      if (sensorId) { query += ' AND sensor_id = ?'; params.push(sensorId); }
      if (startTime) { query += ' AND time >= ?'; params.push(startTime); }
      if (endTime) { query += ' AND time <= ?'; params.push(endTime); }
      query += ' ORDER BY time ASC LIMIT ?';
      params.push(limit);
      const observations = await db.all(query, params);
      return NextResponse.json(observations);
    }

    // ── Tier 3: Mock ──────────────────────────────────────────────────────────
    if (sensorId) {
      const mockHist = getMockHistory(sensorId, startTime || new Date().toISOString());
      return NextResponse.json(mockHist);
    }
    return NextResponse.json([]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
