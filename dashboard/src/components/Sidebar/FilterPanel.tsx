'use client';
 
import React from 'react';
import { Calendar, Sliders, MapPin, Wind, Thermometer, Droplets, Flame } from 'lucide-react';
import { Sensor, Cluster } from '@/types';
 
interface FilterPanelProps {
  counties: string[];
  zoneNames: string[];
  selectedFilter: { type: 'all' | 'county' | 'zone'; value: string };
  onChangeFilter: (filter: { type: 'all' | 'county' | 'zone'; value: string }) => void;
  availableDevices: Sensor[];
  selectedDeviceId: string;
  onChangeDeviceId: (id: string) => void;
 
  startDate: string;
  onChangeStartDate: (date: string) => void;
  endDate: string;
  onChangeEndDate: (date: string) => void;
  startTime: string;
  onChangeStartTime: (time: string) => void;
  endTime: string;
  onChangeEndTime: (time: string) => void;
 
  selectedMetric: 'pm2_5' | 'temperature' | 'humidity' | 'voc';
  onChangeMetric: (metric: 'pm2_5' | 'temperature' | 'humidity' | 'voc') => void;
  minVal: number;
  maxVal: number;
  onChangeMinVal: (val: number) => void;
  onChangeMaxVal: (val: number) => void;
  isLoading: boolean;
  clusters: Cluster[];
  selectedClusterId: string | null;
  onChangeClusterId: (id: string | null) => void;
}
 
export const FilterPanel: React.FC<FilterPanelProps> = ({
  counties,
  zoneNames,
  selectedFilter,
  onChangeFilter,
  availableDevices,
  selectedDeviceId,
  onChangeDeviceId,
  startDate,
  onChangeStartDate,
  endDate,
  onChangeEndDate,
  startTime,
  onChangeStartTime,
  endTime,
  onChangeEndTime,
  selectedMetric,
  onChangeMetric,
  minVal,
  maxVal,
  onChangeMinVal,
  onChangeMaxVal,
  isLoading,
  clusters,
  selectedClusterId,
  onChangeClusterId
}) => {
  // 產生 2026年4月份 30 天的日期選項
  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `2026-04-${day}`;
  });
 
  // 產生 24 小時的 5 分鐘級時間選項
  const timeOptions: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const hourStr = String(h).padStart(2, '0');
      const minStr = String(m).padStart(2, '0');
      timeOptions.push(`${hourStr}:${minStr}:00`);
    }
  }
 
  return (
    <div className="glass-card neon-border rounded-2xl p-4 lg:p-5 flex flex-col gap-4 lg:gap-6 shadow-xl h-full overflow-y-auto">
      {/* 標題 */}
      <div className="border-b border-slate-800/80 pb-3 flex items-center gap-2">
        <Sliders className="text-orange-500 w-5 h-5" />
        <h2 className="text-lg font-bold text-slate-100">空間與時間篩選</h2>
      </div>
 
      {/* 第一層：篩選行政區 or 產業園區 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-slate-500" />
          第一層：篩選行政區/產業園區
        </label>
        <select
          value={selectedFilter.type === 'all' ? 'all' : `${selectedFilter.type}_${selectedFilter.value}`}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'all') {
              onChangeFilter({ type: 'all', value: '' });
            } else {
              const idx = val.indexOf('_');
              const type = val.substring(0, idx) as 'county' | 'zone';
              const value = val.substring(idx + 1);
              onChangeFilter({ type, value });
            }
          }}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="all">All (不篩選區域)</option>
          <optgroup label="行政區">
            {counties.map((c) => (
              <option key={`county_${c}`} value={`county_${c}`}>
                {c}
              </option>
            ))}
          </optgroup>
          <optgroup label="產業園區">
            {zoneNames.map((z) => (
              <option key={`zone_${z}`} value={`zone_${z}`}>
                {z}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
 
      {/* 第二層：篩選 DeviceID */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-slate-500" />
          第二層：篩選 DeviceID
        </label>
        <select
          value={selectedDeviceId}
          onChange={(e) => onChangeDeviceId(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="all">All (不篩選設備)</option>
          {availableDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.id})
            </option>
          ))}
        </select>
      </div>
 
      {/* 日期與時間區間篩選 */}
      <div className="flex flex-col gap-3 lg:gap-4 bg-slate-950/40 border border-slate-800/60 p-3 lg:p-4 rounded-xl">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            觀測日期區間
          </span>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={startDate}
              onChange={(e) => onChangeStartDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 cursor-pointer"
            >
              {dateOptions.map((d) => (
                <option key={`start_${d}`} value={d}>{d}</option>
              ))}
            </select>
            <select
              value={endDate}
              onChange={(e) => onChangeEndDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 cursor-pointer"
            >
              {dateOptions.map((d) => (
                <option key={`end_${d}`} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
 
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            時間區間 (5分鐘級)
          </span>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={startTime}
              onChange={(e) => onChangeStartTime(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 cursor-pointer"
            >
              {timeOptions.map((t) => (
                <option key={`start_t_${t}`} value={t}>{t.substring(0, 5)}</option>
              ))}
            </select>
            <select
              value={endTime}
              onChange={(e) => onChangeEndTime(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 cursor-pointer"
            >
              {timeOptions.map((t) => (
                <option key={`end_t_${t}`} value={t}>{t.substring(0, 5)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
 
      {/* 測項篩選 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <Wind className="w-3.5 h-3.5 text-slate-500" />
          主要展示項目
        </label>
        <select
          value={selectedMetric}
          onChange={(e) => onChangeMetric(e.target.value as any)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="pm2_5">PM₂.₅</option>
          <option value="temperature">溫度</option>
          <option value="humidity">濕度</option>
          <option value="voc">VOC</option>
        </select>
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
 
      {/* 空間疑似燃燒熱區 */}
      <div className="flex flex-col gap-2 border-t border-slate-800/60 pt-4">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
          空間疑似燃燒熱區 ({clusters.length} 處)
        </label>
        <select
          value={selectedClusterId || ''}
          onChange={(e) => onChangeClusterId(e.target.value || null)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="">選擇燃燒熱區 (無選擇)</option>
          {clusters.map((c) => (
            <option key={c.id} value={c.id}>
              熱區 {c.id.substring(0, 6)} ({c.stationsCount}站, PM₂.₅:{c.avgPm25.toFixed(1)})
            </option>
          ))}
        </select>
      </div>
 
      {/* 狀態提示 */}
      <div className="mt-auto border-t border-slate-800/60 pt-4">
        <p className="text-[10px] text-slate-500 leading-relaxed">
          * 資料集為 2026年4月份環境部空氣品質微感測器 5 分鐘高頻觀測數據。
        </p>
      </div>
    </div>
  );
};
 
export default FilterPanel;
