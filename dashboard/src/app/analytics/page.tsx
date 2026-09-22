'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Wind, 
  Flame, 
  Calendar, 
  Building2, 
  AlertTriangle, 
  ShieldAlert, 
  Activity,
  Radio,
  Clock,
  CheckCircle2
} from 'lucide-react';

import { ZoneRankingChart } from '@/components/Analytics/ZoneRankingChart';
import { SensorRankingChart } from '@/components/Analytics/SensorRankingChart';
import { MonthlyTrendChart } from '@/components/Analytics/MonthlyTrendChart';
import { WeekdayHourHeatmap } from '@/components/Analytics/WeekdayHourHeatmap';
import { AnalyticsGISMap } from '@/components/Analytics/AnalyticsGISMap';

interface ZoneData {
  zone: string;
  sensor_count: number;
  pm25_mean: number;
  pm25_p95: number;
  pm25_max: number;
  exceed_pm25_count: number;
  voc_mean: number;
  voc_p95: number;
  voc_max: number;
  exceed_voc_count: number;
  potency_score?: number;
}

interface DailyRecord {
  d: string;
  pm: number;
  p95: number;
  epm: number;
  vm: number;
  vp95: number;
  evoc: number;
  cnt: number;
}

interface AnalyticsPayload {
  generated_at: string;
  data_range: string;
  date_limits?: { min: string; max: string; total_days: number };
  available_dates?: string[];
  available_months: string[];
  zone_summary: ZoneData[];
  all_months_rankings: { [month: string]: ZoneData[] };
  zone_daily?: { [zoneName: string]: DailyRecord[] };
  sensor_summary: { [zoneName: string]: any[] };
  monthly_summary: { [zoneName: string]: any[] };
  weekday_hour_heatmap: { [zoneName: string]: { pm25: number[][]; voc: number[][] } };
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'pm25' | 'voc'>('pm25');
  const [selectedZone, setSelectedZone] = useState<string>('大甲幼獅產業園區');
  const [focusedSensor, setFocusedSensor] = useState<any | null>(null);

  // 時間篩選模式：'preset' (全期或特定季節) | 'custom' (自訂開始~結束日)
  const [timeMode, setTimeMode] = useState<'all' | 'winter' | 'summer' | 'custom'>('all');
  const [startDate, setStartDate] = useState<string>('2025-06-27');
  const [endDate, setEndDate] = useState<string>('2026-09-01');

  const handleZoneChange = (zone: string) => {
    setSelectedZone(zone);
    setFocusedSensor(null);
  };

  useEffect(() => {
    fetch('/zone_rankings.json')
      .then(res => res.json())
      .then((json: AnalyticsPayload) => {
        setData(json);
        if (json.date_limits) {
          setStartDate(json.date_limits.min);
          setEndDate(json.date_limits.max);
        }
        if (json.zone_summary && json.zone_summary.length > 0) {
          const hasDajia = json.zone_summary.some(z => z.zone.includes('大甲幼獅'));
          setSelectedZone(hasDajia ? '大甲幼獅產業園區' : json.zone_summary[0].zone);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('載入分析資料失敗:', err);
        setLoading(false);
      });
  }, []);

  // 快捷週期切換處理
  const handleTimeModeChange = (mode: 'all' | 'winter' | 'summer' | 'custom') => {
    setTimeMode(mode);
    if (!data?.date_limits) return;

    if (mode === 'all') {
      setStartDate(data.date_limits.min);
      setEndDate(data.date_limits.max);
    } else if (mode === 'winter') {
      // 秋冬空污季 (2025-10-01 ~ 2026-03-31)
      setStartDate('2025-10-01');
      setEndDate('2026-03-31');
    } else if (mode === 'summer') {
      // 夏季異味季 (2026-04-01 ~ 2026-08-31)
      setStartDate('2026-04-01');
      setEndDate('2026-08-31');
    }
  };

  // 當使用者手動更改日期輸入框時
  const handleCustomDateChange = (type: 'start' | 'end', val: string) => {
    if (!data?.available_dates || data.available_dates.length === 0) return;
    setTimeMode('custom');

    // 防呆：確認在有效資料日期範圍內
    const minD = data.date_limits?.min || '2025-06-27';
    const maxD = data.date_limits?.max || '2026-09-01';

    let clamped = val;
    if (clamped < minD) clamped = minD;
    if (clamped > maxD) clamped = maxD;

    if (type === 'start') {
      if (clamped > endDate) setEndDate(clamped);
      setStartDate(clamped);
    } else {
      if (clamped < startDate) setStartDate(clamped);
      setEndDate(clamped);
    }
  };

  // 動態根據選定的 [startDate, endDate] 計算各園區最新指標 (毫秒級純前端聚合)
  const activeZoneSummary = useMemo(() => {
    if (!data) return [];
    
    // 全期且未過濾時，使用預計算的 zone_summary，但仍需依 metric 排序
    if (timeMode === 'all' && data.zone_summary) {
      return [...data.zone_summary].sort((a, b) => {
        const valA = metric === 'pm25' ? (a.pm25_mean || 0) : (a.voc_mean || 0);
        const valB = metric === 'pm25' ? (b.pm25_mean || 0) : (b.voc_mean || 0);
        return valB - valA;
      });
    }

    if (!data.zone_daily) {
      return data.zone_summary || [];
    }

    // 依據 startDate ~ endDate 動態計算 19 園區指標
    const result: ZoneData[] = [];
    Object.entries(data.zone_daily).forEach(([zName, dailyList]) => {
      const filtered = dailyList.filter(item => item.d >= startDate && item.d <= endDate);
      if (filtered.length === 0) return;

      const totalCount = filtered.reduce((acc, x) => acc + (x.cnt || 1), 0);
      const pmMean = filtered.reduce((acc, x) => acc + (x.pm * (x.cnt || 1)), 0) / (totalCount || 1);
      const vocMean = filtered.reduce((acc, x) => acc + (x.vm * (x.cnt || 1)), 0) / (totalCount || 1);
      const pmP95 = Math.max(...filtered.map(x => x.p95 || 0));
      const vocP95 = Math.max(...filtered.map(x => x.vp95 || 0));
      const exceedPm = filtered.reduce((acc, x) => acc + (x.epm || 0), 0);
      const exceedVoc = filtered.reduce((acc, x) => acc + (x.evoc || 0), 0);

      // 潛勢評分
      const pmRate = exceedPm / (totalCount || 1);
      const vocRate = exceedVoc / (totalCount || 1);
      const pScore = Math.min(100, Math.round((pmMean * 2.5 + pmRate * 200) * 0.5 + ((vocMean / 2) + vocRate * 150) * 0.5));

      const origZone = data.zone_summary.find(z => z.zone === zName);

      result.push({
        zone: zName,
        sensor_count: origZone?.sensor_count || 0,
        pm25_mean: parseFloat(pmMean.toFixed(2)),
        pm25_p95: parseFloat(pmP95.toFixed(2)),
        pm25_max: origZone?.pm25_max || 0,
        exceed_pm25_count: exceedPm,
        voc_mean: parseFloat(vocMean.toFixed(2)),
        voc_p95: parseFloat(vocP95.toFixed(2)),
        voc_max: origZone?.voc_max || 0,
        exceed_voc_count: exceedVoc,
        potency_score: pScore
      });
    });

    // 依選定指標排序
    result.sort((a, b) => {
      const valA = metric === 'pm25' ? a.pm25_mean : a.voc_mean;
      const valB = metric === 'pm25' ? b.pm25_mean : b.voc_mean;
      return valB - valA;
    });

    return result;
  }, [data, timeMode, startDate, endDate, metric]);

  // 當前選中的園區物件
  const currentZoneData = useMemo(() => {
    return activeZoneSummary.find(z => z.zone === selectedZone) || activeZoneSummary[0];
  }, [activeZoneSummary, selectedZone]);

  // 當前選中園區的微感器清單
  const currentSensors = useMemo(() => {
    if (!data?.sensor_summary) return [];
    return data.sensor_summary[selectedZone] || [];
  }, [data, selectedZone]);

  // 當前選中園區的月份趨勢 (篩選落於選定日期範圍內之月份)
  const currentMonthly = useMemo(() => {
    if (!data?.monthly_summary) return [];
    const full = data.monthly_summary[selectedZone] || [];
    const startM = startDate.slice(0, 7);
    const endM = endDate.slice(0, 7);
    return full.filter(m => m.month >= startM && m.month <= endM);
  }, [data, selectedZone, startDate, endDate]);

  // 當前選中園區的週熱力矩陣
  const currentHeatmap = useMemo(() => {
    if (!data?.weekday_hour_heatmap) return { pm25: [], voc: [] };
    return data.weekday_hour_heatmap[selectedZone] || { pm25: [], voc: [] };
  }, [data, selectedZone]);

  // 最高潛勢園區
  const topPotencyZone = useMemo(() => {
    if (activeZoneSummary.length === 0) return null;
    return [...activeZoneSummary].sort((a, b) => (b.potency_score || 0) - (a.potency_score || 0))[0];
  }, [activeZoneSummary]);

  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-lg font-medium text-slate-300">正在加載全臺中 20 園區長期歷史大數據分析模組...</span>
        </div>
        <p className="text-xs text-slate-500 mt-2">彙整 432 天 × 348 萬筆每小時觀測紀錄</p>
      </div>
    );
  }

  const minValidDate = data.date_limits?.min || '2025-06-27';
  const maxValidDate = data.date_limits?.max || '2026-09-01';

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 pb-16">
      {/* ── 頂部導航列 ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-[#0b111e]/95 backdrop-blur-md border-b border-slate-800 px-5 py-3 shadow-2xl">
        <div className="max-w-[1720px] mx-auto flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
          {/* 左側：返回鍵與標題 */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all border border-slate-700/60"
            >
              <ArrowLeft size={14} />
              即時監測
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-wide text-white flex items-center gap-2">
                  <Activity className="text-orange-500" size={18} />
                  臺中市產業園區空氣品質與異味大數據分析
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-mono">
                  432 DAYS
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                有效數據區間：{minValidDate} ～ {maxValidDate}（19 園區 335 站）
              </p>
            </div>
          </div>

          {/* 右側：指標切換、自訂日期區間與園區篩選 */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* 指標分軌按鈕 */}
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center shrink-0">
              <button
                onClick={() => setMetric('pm25')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isPm25 
                    ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wind size={13} />
                PM2.5 空污
              </button>
              <button
                onClick={() => setMetric('voc')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  !isPm25 
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/20' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Flame size={13} />
                TVOC 異味
              </button>
            </div>

            {/* 週期快捷選單 */}
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center text-xs shrink-0">
              <button
                onClick={() => handleTimeModeChange('all')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                  timeMode === 'all' ? 'bg-slate-800 text-orange-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                全期 (432天)
              </button>
              <button
                onClick={() => handleTimeModeChange('winter')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                  timeMode === 'winter' ? 'bg-slate-800 text-orange-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                秋冬空污季
              </button>
              <button
                onClick={() => handleTimeModeChange('summer')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                  timeMode === 'summer' ? 'bg-slate-800 text-orange-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                春夏期
              </button>
            </div>

            {/* 自訂開始日期 ~ 結束日期 (僅限有資料的有效日期) */}
            <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300 shrink-0 shadow-inner">
              <Calendar size={13} className="text-orange-400" />
              <div className="flex items-center gap-1 font-mono">
                <input
                  type="date"
                  value={startDate}
                  min={minValidDate}
                  max={endDate}
                  onChange={e => handleCustomDateChange('start', e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-orange-500 cursor-pointer"
                  title={`自訂起始日 (範圍: ${minValidDate} ~ ${maxValidDate})`}
                />
                <span className="text-slate-500">至</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={maxValidDate}
                  onChange={e => handleCustomDateChange('end', e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-orange-500 cursor-pointer"
                  title={`自訂結束日 (範圍: ${minValidDate} ~ ${maxValidDate})`}
                />
              </div>
            </div>

            {/* 快速選定園區下拉 */}
            <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300 shrink-0">
              <Building2 size={13} className="text-orange-400" />
              <select
                value={selectedZone}
                onChange={e => handleZoneChange(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer pr-1 max-w-[150px] truncate"
              >
                {activeZoneSummary.map(z => (
                  <option key={z.zone} value={z.zone} className="bg-slate-900 text-slate-200">{z.zone}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* ── 核心內容區 ────────────────────────────────────────────── */}
      <main className="max-w-[1720px] mx-auto px-6 pt-5 space-y-6">
        
        {/* 1. 核心 KPI 摘要卡片列 (隨日期區間動態運算) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 卡片 1: 自訂期間最高潛勢熱區 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg relative overflow-hidden">
            <div className="absolute -right-4 -bottom-4 opacity-5 text-orange-500 pointer-events-none">
              <ShieldAlert size={110} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <ShieldAlert size={14} className="text-rose-400" />
                區間綜合污染高潛勢之冠
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                潛勢分 {topPotencyZone?.potency_score ?? '--'}
              </span>
            </div>
            <div className="mt-2.5">
              <h3 className="text-lg font-bold text-white truncate">{topPotencyZone?.zone ?? '--'}</h3>
              <p className="text-xs text-slate-400 mt-1">
                PM2.5 均值 <b className="text-rose-400">{topPotencyZone?.pm25_mean}</b> μg/m³ ｜ TVOC 均值 <b className="text-purple-400">{topPotencyZone?.voc_mean}</b> ppb
              </p>
            </div>
          </div>

          {/* 卡片 2: 當前焦點園區區間平均濃度 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1 truncate max-w-[200px]">
                {isPm25 ? <Wind size={14} className="text-orange-400 shrink-0" /> : <Flame size={14} className="text-purple-400 shrink-0" />}
                {selectedZone}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {timeMode === 'all' ? '全期 432 天' : `${startDate} ~ ${endDate}`}
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className={`text-2xl font-black ${isPm25 ? 'text-orange-400' : 'text-purple-400'}`}>
                {isPm25 ? currentZoneData?.pm25_mean : currentZoneData?.voc_mean}
              </span>
              <span className="text-xs text-slate-400 font-medium">{unit}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              P95 極端高值: <b className="text-slate-300">{isPm25 ? currentZoneData?.pm25_p95 : currentZoneData?.voc_p95} {unit}</b>
            </p>
          </div>

          {/* 卡片 3: 超標小時累積次數 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <AlertTriangle size={14} className="text-amber-400" />
                感測器超標觀測次數
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono">
                {isPm25 ? '≥ 50.4 μg/m³' : '≥ 500 ppb'}
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-amber-400">
                {(isPm25 ? currentZoneData?.exceed_pm25_count : currentZoneData?.exceed_voc_count)?.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">感測器-小時次 (累計)</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              日期範圍共涵蓋 <b className="text-slate-300">{Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 3600 * 24)) + 1)}</b> 天觀測
            </p>
          </div>

          {/* 卡片 4: 微感器密度與配置 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <Radio size={14} className="text-sky-400" />
                園區微型感測器配置
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 font-mono">
                500m BUFFER
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-sky-400">
                {currentSensors.length}
              </span>
              <span className="text-xs text-slate-400">支有效測站</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 truncate">
              歷史最劣站: <b className="text-slate-300">{currentSensors[0]?.name || '--'}</b> ({currentSensors[0]?.pm25_mean || '--'} μg/m³)
            </p>
          </div>
        </section>

        {/* 2. 上層主要圖表：左側園區排名橫條圖 (動態日聚合) + 右側 GIS 熱區地圖 */}
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* 左側：Highcharts 園區排名 */}
          <div className="xl:col-span-6 flex flex-col">
            <ZoneRankingChart
              data={activeZoneSummary}
              metric={metric}
              selectedZone={selectedZone}
              onSelectZone={handleZoneChange}
              selectedMonth={`${startDate} ~ ${endDate}`}
            />
          </div>

          {/* 右側：GIS 熱區地圖 (動態反映選定區間之園區與測站色彩) */}
          <div className="xl:col-span-6 flex flex-col">
            <AnalyticsGISMap
              zoneSummary={activeZoneSummary}
              sensorSummary={data.sensor_summary}
              selectedZone={selectedZone}
              onSelectZone={handleZoneChange}
              metric={metric}
              onChangeMetric={setMetric}
              selectedMonth={`${startDate} ~ ${endDate}`}
              focusedSensor={focusedSensor}
              onSelectSensor={setFocusedSensor}
            />
          </div>
        </section>

        {/* 3. 下層詳細圖表：微感器排名 + 歷史月份趨勢 */}
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* 左側：微感器排行 (點擊柱狀圖可於右上角 GIS 動畫聚焦) */}
          <div className="xl:col-span-6">
            <SensorRankingChart
              sensors={currentSensors}
              metric={metric}
              zoneName={selectedZone}
              onSelectSensor={setFocusedSensor}
            />
          </div>

          {/* 右側：歷史月份趨勢 (自動聚焦所選區間) */}
          <div className="xl:col-span-6">
            <MonthlyTrendChart
              monthlyData={currentMonthly}
              metric={metric}
              zoneName={selectedZone}
            />
          </div>
        </section>

        {/* 4. 底部全寬：星期 × 時段 7x24 週期熱力矩陣與智慧稽查建議 */}
        <section>
          <WeekdayHourHeatmap
            data={currentHeatmap}
            metric={metric}
            zoneName={selectedZone}
            onToggleMetric={setMetric}
          />
        </section>

      </main>
    </div>
  );
}
