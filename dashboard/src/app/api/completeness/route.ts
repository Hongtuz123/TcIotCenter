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

    // 4. 找出最近 1 小時內有回報資料的測站（用站數維度計算完整率）
    const { data: activeSensors } = await supabase
      .from('observations_5m')
      .select('station_id')
      .gte('bucket_time', windowStart)
      .lte('bucket_time', windowEnd)
      .range(0, 25000);

    const activeSensorIds = new Set((activeSensors || []).map((r: any) => r.station_id));
    const onlineCount = activeSensorIds.size;
    const offlineCount = Math.max(0, total - onlineCount);

    // 完整率 = 有回報的站數 ÷ 總站數（語意：有多少比例的站還在線上）
    const rate = total > 0 ? onlineCount / total : 0;

    // 供 debug 用的桶數統計
    const actual = actualCount || 0;
    const expected = total * 12; // 理論上 1h × 每 5 分鐘 = 12 個桶

    return NextResponse.json({
      rate: Math.round(rate * 1000) / 10, // 百分比，一位小數
      mode: 'supabase',
      debug_host: process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null,
      total_sensors: total,
      online_count: onlineCount,
      offline_count: offlineCount,
      // 桶數 debug 資訊
      expected_obs: expected,
      actual_obs: actual,
      bucket_completeness: expected > 0 ? Math.round((actual / expected) * 1000) / 10 : 0,
      window_start: windowStart,
      window_end: windowEnd,
      // 歷史快照（最新一筆）
      last_snapshot: logData || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
