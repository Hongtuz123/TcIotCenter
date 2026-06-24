'use client';

import React from 'react';
import { Calendar, Sliders, MapPin, Wind, Thermometer, Droplets, Flame } from 'lucide-react';

interface FilterPanelProps {
  counties: string[];
  selectedCounty: string;
  onChangeCounty: (county: string) => void;
  selectedDate: string; // 格式: '2026-04-01' 等
  onChangeDate: (date: string) => void;
  selectedTimeSlot: string; // 格式: '10:00:00' 等
  onChangeTimeSlot: (time: string) => void;
  selectedMetric: 'pm2_5' | 'temperature' | 'humidity';
  onChangeMetric: (metric: 'pm2_5' | 'temperature' | 'humidity') => void;
  minVal: number;
  maxVal: number;
  onChangeMinVal: (val: number) => void;
  onChangeMaxVal: (val: number) => void;
  isLoading: boolean;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  counties,
  selectedCounty,
  onChangeCounty,
  selectedDate,
  onChangeDate,
  selectedTimeSlot,
  onChangeTimeSlot,
  selectedMetric,
  onChangeMetric,
  minVal,
  maxVal,
  onChangeMinVal,
  onChangeMaxVal,
  isLoading
}) => {
  // 產生 2026年4月份 30 天的日期選項
  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `2026-04-${day}`;
  });

  // 產生 24 小時的 5 分鐘級時間選項 (00:00:00, 00:05:00, ..., 23:55:00)
  const timeOptions: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const hourStr = String(h).padStart(2, '0');
      const minStr = String(m).padStart(2, '0');
      timeOptions.push(`${hourStr}:${minStr}:00`);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 lg:p-5 flex flex-col gap-4 lg:gap-6 shadow-xl h-auto lg:h-full overflow-y-auto">
      {/* 標題 */}
      <div className="border-b border-slate-800 pb-3 flex items-center gap-2">
        <Sliders className="text-orange-500 w-5 h-5" />
        <h2 className="text-lg font-bold text-slate-100">空間與時間篩選</h2>
      </div>

      {/* 行政區篩選 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-slate-500" />
          篩選行政區
        </label>
        <select
          value={selectedCounty}
          onChange={(e) => onChangeCounty(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="">全部行政區</option>
          {counties.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* 時間與日期篩選 */}
      <div className="flex flex-col gap-3 lg:gap-4 bg-slate-950/40 border border-slate-800/60 p-3 lg:p-4 rounded-xl">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            選擇觀測日期
          </label>
          <select
            value={selectedDate}
            onChange={(e) => onChangeDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
          >
            {dateOptions.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            對齊時間點 (5分鐘級)
          </label>
          <select
            value={selectedTimeSlot}
            onChange={(e) => onChangeTimeSlot(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
          >
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time.substring(0, 5)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 測項篩選 */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5 text-slate-500" />
          主要展示項目
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChangeMetric('pm2_5')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1 ${
              selectedMetric === 'pm2_5'
                ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <Wind className="w-3 h-3" />
            PM2.5
          </button>
          <button
            onClick={() => onChangeMetric('temperature')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1 ${
              selectedMetric === 'temperature'
                ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <Thermometer className="w-3 h-3" />
            溫度
          </button>
          <button
            onClick={() => onChangeMetric('humidity')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1 ${
              selectedMetric === 'humidity'
                ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <Droplets className="w-3 h-3" />
            濕度
          </button>
          <button
            onClick={() => onChangeMetric('voc')}
            className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1 ${
              selectedMetric === 'voc'
                ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <Flame className="w-3 h-3" />
            VOC
          </button>
        </div>
      </div>

      {/* 測值區間 */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-400">
          設定數值區間
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={minVal}
            onChange={(e) => onChangeMinVal(Number(e.target.value))}
            placeholder="Min"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
          />
          <span className="text-slate-600 text-xs">~</span>
          <input
            type="number"
            value={maxVal}
            onChange={(e) => onChangeMaxVal(Number(e.target.value))}
            placeholder="Max"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      {/* 狀態提示 */}
      <div className="mt-auto border-t border-slate-800/60 pt-4 flex flex-col gap-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-500">更新狀態:</span>
          {isLoading ? (
            <span className="text-orange-400 flex items-center gap-1 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              正在載入觀測點...
            </span>
          ) : (
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              資料連線正常
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          * 資料集為 2026年4月份環境部空氣品質微感測器 5 分鐘高頻觀測數據。
        </p>
      </div>
    </div>
  );
};

export default FilterPanel;
