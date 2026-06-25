'use client';

import React, { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Observation, Sensor } from '@/types';
import { TrendingUp, Activity, BarChart2, ShieldAlert, CheckCircle } from 'lucide-react';

interface TrendChartProps {
  selectedSensor: Sensor | null;
  historyData: Observation[];
  pm25Threshold: number;
}

export const TrendChart: React.FC<TrendChartProps> = ({
  selectedSensor,
  historyData,
  pm25Threshold
}) => {
  const [metricTab, setMetricTab] = useState<'pm2_5' | 'temperature' | 'humidity'>('pm2_5');

  if (!selectedSensor) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col items-center justify-center text-slate-500 text-center h-full min-h-[300px]">
        <BarChart2 className="w-12 h-12 mb-3 text-slate-700 animate-pulse" />
        <p className="text-sm font-bold mb-1">未選取感測站點</p>
        <p className="text-xs text-slate-600 max-w-[250px] leading-relaxed">
          請點選地圖上的任何一個微感測點以加載並查看其 30 天歷史數據與多測項變化趨勢。
        </p>
      </div>
    );
  }

  // 1. 計算資料摘要
  const validData = historyData.filter((d) => d[metricTab] !== null);
  const values = validData.map((d) => d[metricTab] as number);
  
  const maxVal = values.length > 0 ? Math.max(...values) : 0;
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const avgVal = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

  // 計算超標次數 (僅針對 PM2.5)
  const exceedCount = historyData.filter((d) => (d.pm2_5 || 0) >= pm25Threshold).length;

  // 格式化圖表時間軸 (去除日期只留小時/分鐘，或者留日期，視歷史數據跨度而定)
  const chartData = historyData.map((d) => {
    // 原始格式 '2026-04-02 10:10:00' -> 簡化為 '04/02 10:10'
    let timeLabel = d.time;
    if (d.time && d.time.length >= 16) {
      timeLabel = `${d.time.substring(5, 10)} ${d.time.substring(11, 16)}`;
    }
    return {
      ...d,
      timeLabel
    };
  });

  // 設定 Recharts 漸層主色
  let strokeColor = '#f97316'; // orange-500
  let fillColor = 'url(#colorOrange)';
  let unit = '';

  if (metricTab === 'temperature') {
    strokeColor = '#f43f5e'; // rose-500
    fillColor = 'url(#colorRose)';
    unit = ' °C';
  } else if (metricTab === 'humidity') {
    strokeColor = '#06b6d4'; // cyan-500
    fillColor = 'url(#colorCyan)';
    unit = ' %';
  } else {
    unit = ' ug/m³';
  }

  return (
    <div className="glass-card neon-border rounded-2xl p-5 flex flex-col gap-5 shadow-xl h-full">
      {/* 頂部控制列 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <Activity className="text-orange-500 w-4 h-4" />
            <h3 className="text-sm font-bold text-slate-200">{selectedSensor.name} ({selectedSensor.id})</h3>
          </div>
          <span className="text-[10px] text-slate-500">位置：{selectedSensor.county} 行政區</span>
        </div>

        {/* 測項切換 */}
        <div className="flex gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {(['pm2_5', 'temperature', 'humidity'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMetricTab(tab)}
              className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                metricTab === tab
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'pm2_5' ? 'PM₂.₅' : tab === 'temperature' ? '溫度' : '濕度'}
            </button>
          ))}
        </div>
      </div>

      {/* 資料摘要卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="stat-card-orange bg-gradient-to-b from-slate-900/80 to-slate-950/60 border-t-2 border-t-orange-500 border border-slate-800/60 p-3 rounded-xl flex flex-col">
          <span className="text-[10px] text-slate-500 font-semibold mb-1">最大觀測值</span>
          <span className="text-lg font-bold text-slate-200">
            {maxVal.toFixed(1)}
            <span className="text-xs text-slate-400 font-normal ml-0.5">{unit}</span>
          </span>
        </div>

        <div className="stat-card-cyan bg-gradient-to-b from-slate-900/80 to-slate-950/60 border-t-2 border-t-cyan-500 border border-slate-800/60 p-3 rounded-xl flex flex-col">
          <span className="text-[10px] text-slate-500 font-semibold mb-1">平均觀測值</span>
          <span className="text-lg font-bold text-slate-200">
            {avgVal.toFixed(1)}
            <span className="text-xs text-slate-400 font-normal ml-0.5">{unit}</span>
          </span>
        </div>

        <div className="stat-card-rose bg-gradient-to-b from-slate-900/80 to-slate-950/60 border-t-2 border-t-rose-500 border border-slate-800/60 p-3 rounded-xl flex flex-col">
          <span className="text-[10px] text-slate-500 font-semibold mb-1">最小觀測值</span>
          <span className="text-lg font-bold text-slate-200">
            {minVal.toFixed(1)}
            <span className="text-xs text-slate-400 font-normal ml-0.5">{unit}</span>
          </span>
        </div>

        <div className="stat-card-red bg-gradient-to-b from-slate-900/80 to-slate-950/60 border-t-2 border-t-red-500 border border-slate-800/60 p-3 rounded-xl flex flex-col">
          <span className="text-[10px] text-slate-500 font-semibold mb-1">PM₂.₅ 超標次數</span>
          <span className="text-lg font-bold text-slate-200 flex items-center gap-1.5">
            {exceedCount > 0 ? (
              <>
                <span className="text-red-400">{exceedCount} 次</span>
                <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" />
              </>
            ) : (
              <>
                <span className="text-emerald-400">0 次</span>
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </>
            )}
          </span>
        </div>
      </div>

      {/* 趨勢圖表主區 */}
      <div className="flex-1 w-full min-h-[220px] bg-slate-950/30 rounded-xl p-2 border border-slate-850/50">
        {chartData.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs italic">
            此站點在當前時間範圍內無觀測值。
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorOrange" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorRose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorCyan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorPurple" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="timeLabel"
                stroke="#64748b"
                fontSize={9}
                tickLine={false}
              />
              <YAxis
                stroke="#64748b"
                fontSize={9}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #1e293b',
                  borderRadius: '12px',
                  color: '#f8fafc',
                  fontFamily: 'sans-serif',
                  fontSize: '11px'
                }}
              />
              <Area
                type="monotone"
                dataKey={metricTab}
                stroke={strokeColor}
                strokeWidth={2}
                fillOpacity={1}
                fill={fillColor}
                name={metricTab === 'pm2_5' ? 'PM₂.₅' : metricTab === 'temperature' ? '溫度' : '濕度'}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default TrendChart;
