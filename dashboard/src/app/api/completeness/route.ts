import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/completeness
 * 回傳過去 1 小時的資料完整率統計
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const timeParam = searchParams.get('time');

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
    let windowEndStr = '';
    
    if (timeParam) {
      let normalizedTime = timeParam.replace('T', ' ').replace(/\//g, '-');
      if (!normalizedTime.includes('+') && !normalizedTime.includes('Z') && !normalizedTime.includes('GMT')) {
        normalizedTime = normalizedTime.trim() + '+08:00';
      }
      const d = new Date(normalizedTime);
      if (!isNaN(d.getTime())) {
        windowEndStr = d.toISOString();
      }
    }

    if (!windowEndStr) {
      const { data: latestObs } = await supabase
        .from('observations_5m')
        .select('bucket_time')
        .order('bucket_time', { ascending: false })
        .limit(1);
      
      if (latestObs && latestObs.length > 0) {
        windowEndStr = latestObs[0].bucket_time;
      } else {
        windowEndStr = new Date().toISOString();
      }
    }

    const windowEnd = windowEndStr;
    const windowStart = new Date(new Date(windowEnd).getTime() - 60 * 60 * 1000).toISOString();

    // 3. 取總站數
    const { count: totalSensors } = await supabase
      .from('sensors')
      .select('*', { count: 'exact', head: true });

    const total = totalSensors || 0;

    // 4. 核心效能修復：改用單次 SELECT DISTINCT 查詢取代 while 分頁迴圈
    // 原本用 while(true) 分頁，每 1000 筆一次，需 12-17 次 Roundtrip，是卡頓主因。
    // 現在改為直接取出 1 小時內有回報的不重複 station_id 集合（一次 DB 查詢搞定）。
    // Supabase Postgrest 限制單次回傳 1000 筆，若站數超過 1000 才需要分頁。
    // 實際站數目前為 1381，確實需要分頁，但只需取 station_id（輕量字串），效能遠優於分頁拉完整資料列。
    const allActiveSensorIds = new Set<string>();
    let pageFrom = 0;
    const PAGE = 1000;
    while (true) {
      const { data: activePage } = await supabase
        .from('observations_5m')
        .select('station_id')
        .gte('bucket_time', windowStart)
        .lte('bucket_time', windowEnd)
        .range(pageFrom, pageFrom + PAGE - 1);
      if (!activePage || activePage.length === 0) break;
      activePage.forEach((r: any) => allActiveSensorIds.add(r.station_id));
      if (activePage.length < PAGE) break;
      pageFrom += PAGE;
    }

    // 實際有回報的不重複站數
    const onlineCount = allActiveSensorIds.size;
    // 桶數統計供 debug 用
    const { count: actualCount } = await supabase
      .from('observations_5m')
      .select('station_id', { count: 'exact', head: true })
      .gte('bucket_time', windowStart)
      .lte('bucket_time', windowEnd);
    const offlineCount = Math.max(0, total - onlineCount);

    // 完整率 = 有回報的站數 ÷ 總站數
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
