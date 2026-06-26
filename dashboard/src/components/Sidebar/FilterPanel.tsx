'use client';
 
import React from 'react';
import { Calendar, Sliders, MapPin, Wind, Thermometer, Droplets, Flame } from 'lucide-react';
import { Sensor, Observation } from '@/types';
 
interface FilterPanelProps {
  counties: string[];
  zoneNames: string[];
  selectedFilter: { type: 'all' | 'county' | 'zone'; value: string };
  onChangeFilter: (filter: { type: 'all' | 'county' | 'zone'; value: string }) => void;
  availableDevices: Sensor[];
  selectedDeviceId: string;
  onChangeDeviceId: (id: string) => void;
 
  startDateTime: string;
  onChangeStartDateTime: (dt: string) => void;
  endDateTime: string;
  onChangeEndDateTime: (dt: string) => void;
  maxEndDateTime: string;
 
  selectedMetric: 'pm2_5' | 'temperature' | 'humidity';
  onChangeMetric: (metric: 'pm2_5' | 'temperature' | 'humidity') => void;
  minVal: number;
  maxVal: number;
  onChangeMinVal: (val: number) => void;
  onChangeMaxVal: (val: number) => void;
  isLoading: boolean;
  highPollutionDevices: (Sensor & Observation)[];
  selectedHighPollutionDeviceId: string | null;
  onChangeHighPollutionDeviceId: (id: string | null) => void;
}
 
export const FilterPanel: React.FC<FilterPanelProps> = ({
  counties,
  zoneNames,
  selectedFilter,
  onChangeFilter,
  availableDevices,
  selectedDeviceId,
  onChangeDeviceId,
  startDateTime,
  onChangeStartDateTime,
  endDateTime,
  onChangeEndDateTime,
  maxEndDateTime,
  selectedMetric,
  onChangeMetric,
  minVal,
  maxVal,
  onChangeMinVal,
  onChangeMaxVal,
  isLoading,
  highPollutionDevices,
  selectedHighPollutionDeviceId,
  onChangeHighPollutionDeviceId
}) => {
  return (
    <div className="glass-card neon-border rounded-2xl p-4 lg:p-5 flex flex-col gap-4 lg:gap-6 shadow-xl h-full overflow-y-auto">
      {/* 標題 */}
      <div className="border-b border-slate-800/80 pb-3 flex items-center gap-2">
        <Sliders className="text-orange-500 w-5 h-5" />
        <h2 className="text-lg font-bold text-slate-100">空間與時間篩選</h2>
      </div>
 
      {/* 第一層：篩選產業園區 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-slate-500" />
          第一層：篩選產業園區
        </label>
        <select
          value={selectedFilter.type === 'zone' ? `zone_${selectedFilter.value}` : 'all'}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'all') {
              onChangeFilter({ type: 'all', value: '' });
            } else {
              const value = val.substring(5); // 移除 'zone_' 前綴
              onChangeFilter({ type: 'zone', value });
            }
          }}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="all">All (不篩選園區)</option>
          {zoneNames.map((z) => (
            <option key={`zone_${z}`} value={`zone_${z}`}>
              {z}
            </option>
          ))}
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
            開始時間
          </span>
          <input
            type="datetime-local"
            value={startDateTime}
            min="2026-04-01T00:00"
            max={endDateTime || maxEndDateTime}
            onChange={(e) => onChangeStartDateTime(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 cursor-pointer w-full"
          />
        </div>
 
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            結束時間
          </span>
          <input
            type="datetime-local"
            value={endDateTime}
            min={startDateTime || "2026-04-01T00:00"}
            max={maxEndDateTime}
            onChange={(e) => onChangeEndDateTime(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 cursor-pointer w-full"
          />
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
 
      {/* 高污染設備 */}
      <div className="flex flex-col gap-2 border-t border-slate-800/60 pt-4">
        <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          超標高污染設備 ({highPollutionDevices.length} 處)
        </label>
        <select
          value={selectedHighPollutionDeviceId || ''}
          onChange={(e) => onChangeHighPollutionDeviceId(e.target.value || null)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition-colors w-full cursor-pointer"
        >
          <option value="">選擇高污染設備 (無選擇)</option>
          {highPollutionDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name || d.id} (PM₂.₅: {d.pm2_5 !== null && d.pm2_5 !== undefined ? d.pm2_5.toFixed(1) : 'N/A'})
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
