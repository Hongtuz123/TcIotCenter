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
  TrendingUp, 
  Radio, 
  FileText,
  Activity
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

interface AnalyticsPayload {
  generated_at: string;
  data_range: string;
  available_months: string[];
  zone_summary: ZoneData[];
  all_months_rankings: { [month: string]: ZoneData[] };
  sensor_summary: { [zoneName: string]: any[] };
  monthly_summary: { [zoneName: string]: any[] };
  weekday_hour_heatmap: { [zoneName: string]: { pm25: number[][]; voc: number[][] } };
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'pm25' | 'voc'>('pm25');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedZone, setSelectedZone] = useState<string>('大甲幼獅產業園區');
  const [focusedSensor, setFocusedSensor] = useState<any | null>(null);

  const handleZoneChange = (zone: string) => {
    setSelectedZone(zone);
    setFocusedSensor(null);
  };

  useEffect(() => {
    fetch('/zone_rankings.json')
      .then(res => res.json())
      .then((json: AnalyticsPayload) => {
        setData(json);
        if (json.zone_summary && json.zone_summary.length > 0) {
          // 預設選第一個園區或大甲幼獅
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

  // 當前月份切換時的園區統計清單
  const activeZoneSummary = useMemo(() => {
    if (!data) return [];
    if (selectedMonth === 'all') return data.zone_summary;
    return data.all_months_rankings[selectedMonth] || data.zone_summary;
  }, [data, selectedMonth]);

  // 當前選中的園區物件
  const currentZoneData = useMemo(() => {
    return activeZoneSummary.find(z => z.zone === selectedZone) || activeZoneSummary[0];
  }, [activeZoneSummary, selectedZone]);

  // 當前選中園區的微感器清單
  const currentSensors = useMemo(() => {
    if (!data?.sensor_summary) return [];
    return data.sensor_summary[selectedZone] || [];
  }, [data, selectedZone]);

  // 當前選中園區的月份趨勢
  const currentMonthly = useMemo(() => {
    if (!data?.monthly_summary) return [];
    return data.monthly_summary[selectedZone] || [];
  }, [data, selectedZone]);

  // 當前選中園區的週熱力矩陣
  const currentHeatmap = useMemo(() => {
    if (!data?.weekday_hour_heatmap) return { pm25: [], voc: [] };
    return data.weekday_hour_heatmap[selectedZone] || { pm25: [], voc: [] };
  }, [data, selectedZone]);

  // 計算最高潛勢園區
  const topPotencyZone = useMemo(() => {
    if (!data?.zone_summary) return null;
    return [...data.zone_summary].sort((a, b) => (b.potency_score || 0) - (a.potency_score || 0))[0];
  }, [data]);

  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-lg font-medium text-slate-300">正在加載全臺中 20 園區長期歷史分析大數據...</span>
        </div>
        <p className="text-xs text-slate-500 mt-2">彙整 432 天 × 348 萬筆每小時觀測紀錄</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 pb-16">
      {/* ── 頂部導航列 ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-[#0b111e]/90 backdrop-blur-md border-b border-slate-800 px-6 py-3.5 shadow-2xl">
        <div className="max-w-[1720px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          {/* 左側：返回鍵與標題 */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all border border-slate-700/60"
            >
              <ArrowLeft size={14} />
              即時監測中心
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-wide text-white flex items-center gap-2">
                  <Activity className="text-orange-500" size={20} />
                  臺中市產業園區空氣品質與異味大數據分析
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-mono">
                  HISTORICAL BIG DATA
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                數據範圍：{data.data_range} ｜ 涵蓋 19 個主要產業園區 ｜ 335 支微型感測器
              </p>
            </div>
          </div>

          {/* 右側：指標切換與月份篩選 */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 指標分軌按鈕 */}
            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center">
              <button
                onClick={() => setMetric('pm25')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  isPm25 
                    ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wind size={14} />
                空污指標 (PM2.5)
              </button>
              <button
                onClick={() => setMetric('voc')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  !isPm25 
                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/20' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Flame size={14} />
                異味指標 (TVOC)
              </button>
            </div>

            {/* 月份選擇下拉 */}
            <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300">
              <Calendar size={14} className="text-orange-400" />
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer pr-2"
              >
                <option value="all" className="bg-slate-900 text-slate-200">全部歷史 (432 天全週期)</option>
                {data.available_months.map(m => (
                  <option key={m} value={m} className="bg-slate-900 text-slate-200">{m} 月度數據</option>
                ))}
              </select>
            </div>

            {/* 快速選定園區下拉 */}
            <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300">
              <Building2 size={14} className="text-orange-400" />
              <select
                value={selectedZone}
                onChange={e => handleZoneChange(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer pr-2 max-w-[160px] truncate"
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
      <main className="max-w-[1720px] mx-auto px-6 pt-6 space-y-6">
        
        {/* 1. 核心 KPI 摘要卡片列 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 卡片 1: 全臺中最高潛勢熱區 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg relative overflow-hidden">
            <div className="absolute -right-4 -bottom-4 opacity-5 text-orange-500 pointer-events-none">
              <ShieldAlert size={110} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <ShieldAlert size={14} className="text-rose-400" />
                全臺中綜合污染高潛勢之冠
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                潛勢指數 {topPotencyZone?.potency_score ?? '--'}
              </span>
            </div>
            <div className="mt-2.5">
              <h3 className="text-lg font-bold text-white truncate">{topPotencyZone?.zone ?? '--'}</h3>
              <p className="text-xs text-slate-400 mt-1">
                PM2.5 均值 <b className="text-rose-400">{topPotencyZone?.pm25_mean}</b> μg/m³ ｜ TVOC 均值 <b className="text-purple-400">{topPotencyZone?.voc_mean}</b> ppb
              </p>
            </div>
          </div>

          {/* 卡片 2: 當前焦點園區平均濃度 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                {isPm25 ? <Wind size={14} className="text-orange-400" /> : <Flame size={14} className="text-purple-400" />}
                {selectedZone} 平均濃度
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {selectedMonth === 'all' ? '歷史總均值' : selectedMonth}
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

          {/* 卡片 3: 超標小時總次數 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <AlertTriangle size={14} className="text-amber-400" />
                超標警戒小時數
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono">
                {isPm25 ? '> 35 μg/m³' : '> 150 ppb'}
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-amber-400">
                {(isPm25 ? currentZoneData?.exceed_pm25_count : currentZoneData?.exceed_voc_count)?.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">次 (累積小時)</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              最高觀測極值: <b className="text-slate-300">{isPm25 ? currentZoneData?.pm25_max : currentZoneData?.voc_max} {unit}</b>
            </p>
          </div>

          {/* 卡片 4: 微感器配置密度 */}
          <div className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border border-slate-800/80 rounded-xl p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <Radio size={14} className="text-sky-400" />
                園區微型感測器覆蓋
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 font-mono">
                500m BUFFER
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-sky-400">
                {currentSensors.length}
              </span>
              <span className="text-xs text-slate-400">支感測點位</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 truncate">
              最劣監測站: <b className="text-slate-300">{currentSensors[0]?.name || '--'}</b> ({currentSensors[0]?.pm25_mean || '--'} μg/m³)
            </p>
          </div>
        </section>

        {/* 2. 上層主要圖表：左側園區排名橫條圖 + 右側 GIS 熱區地圖 */}
        <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* 左側：Highcharts 園區排名 */}
          <div className="xl:col-span-6 flex flex-col">
            <ZoneRankingChart
              data={activeZoneSummary}
              metric={metric}
              selectedZone={selectedZone}
              onSelectZone={handleZoneChange}
              selectedMonth={selectedMonth}
            />
          </div>

          {/* 右側：GIS 熱區地圖 (支援 PM2.5 / TVOC 切換、AQI 色階與站點選取動畫) */}
          <div className="xl:col-span-6 flex flex-col">
            <AnalyticsGISMap
              zoneSummary={activeZoneSummary}
              sensorSummary={data.sensor_summary}
              selectedZone={selectedZone}
              onSelectZone={handleZoneChange}
              metric={metric}
              onChangeMetric={setMetric}
              selectedMonth={selectedMonth}
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

          {/* 右側：歷史月份趨勢 */}
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
