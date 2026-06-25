import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/completeness
 * 回傳過去 1 小時的資料完整率統計
 */
export async function GET() {
  try {
    if (!supabase) {
      // Mock mode：回傳假資料
      return NextResponse.json({
        rate: null,
        mode: 'mock',
        message: 'Supabase 未設定，顯示 Mock 資料',
        total_sensors: 6,
        expected_obs: 72,
        actual_obs: 72,
        offline_count: 0,
        window_start: null,
        window_end: null,
      });
    }

    // 1. 取最新一筆完整率紀錄
    const { data: logData } = await supabase
      .from('completeness_log')
      .select('*')
      .order('snapshot_time', { ascending: false })
      .limit(1)
      .single();

    // 2. 即時計算過去 1 小時內有資料的站數
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const windowEnd = new Date().toISOString();

    const { count: actualCount } = await supabase
      .from('observations_5m')
      .select('station_id', { count: 'exact', head: true })
      .gte('bucket_time', windowStart)
      .lte('bucket_time', windowEnd);

    // 3. 取總站數
    const { count: totalSensors } = await supabase
      .from('sensors')
      .select('*', { count: 'exact', head: true });

    const total = totalSensors || 0;
    const actual = actualCount || 0;
    const expected = total * 12; // 1 小時 × 每 5 分鐘 = 12 個桶
    const rate = expected > 0 ? Math.min(actual / expected, 1.0) : 0;

    // 4. 找出最近 1 小時完全無資料的測站（判定為離線）
    const { data: activeSensors } = await supabase
      .from('observations_5m')
      .select('station_id')
      .gte('bucket_time', windowStart)
      .lte('bucket_time', windowEnd);

    const activeSensorIds = new Set((activeSensors || []).map((r: any) => r.station_id));
    const offlineCount = Math.max(0, total - activeSensorIds.size);

    return NextResponse.json({
      rate: Math.round(rate * 1000) / 10, // 百分比，一位小數
      mode: 'supabase',
      total_sensors: total,
      expected_obs: expected,
      actual_obs: actual,
      offline_count: offlineCount,
      online_count: activeSensorIds.size,
      window_start: windowStart,
      window_end: windowEnd,
      // 歷史快照（最新一筆）
      last_snapshot: logData || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
