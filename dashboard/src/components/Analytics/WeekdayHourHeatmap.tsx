'use client';

import React, { useState, useEffect } from 'react';
import { Wind, Flame } from 'lucide-react';

interface WeekdayHourHeatmapProps {
  data: {
    pm25: number[][]; // [7][24]
    voc: number[][];  // [7][24]
  };
  metric: 'pm25' | 'voc';
  zoneName: string;
  onToggleMetric?: (metric: 'pm25' | 'voc') => void;
}

const WEEKDAYS = ['週一 (Mon)', '週二 (Tue)', '週三 (Wed)', '週四 (Thu)', '週五 (Fri)', '週六 (Sat)', '週日 (Sun)'];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

export const WeekdayHourHeatmap: React.FC<WeekdayHourHeatmapProps> = ({
  data,
  metric: initialMetric,
  zoneName,
  onToggleMetric
}) => {
  const [internalMetric, setInternalMetric] = useState<'pm25' | 'voc'>(initialMetric);
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number; val: number } | null>(null);

  // 當外部 metric 改變時同步
  useEffect(() => {
    setInternalMetric(initialMetric);
  }, [initialMetric]);

  const handleMetricChange = (newMetric: 'pm25' | 'voc') => {
    setInternalMetric(newMetric);
    if (onToggleMetric) {
      onToggleMetric(newMetric);
    }
  };

  const isPm25 = internalMetric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';
  const matrix = isPm25 ? data?.pm25 : data?.voc;

  /**
   * 官方 AQI 色彩對應系統：
   * PM2.5 (上限 125.4):
   *   0.0 ~ 12.4   -> 良好 (綠 #10b981)
   *   12.5 ~ 30.4  -> 普通 (黃 #eab308)
   *   30.5 ~ 50.4  -> 對敏感族群不健康 (橘 #f97316)
   *   50.5 ~ 125.4 -> 對所有族群不健康 (紅 #ef4444)
   *   > 125.4      -> 非常不健康 (紫 #a855f7)
   *
   * TVOC (按 PM2.5 比例對齊，上限 15,000):
   *   0 ~ 1,500     -> 良好 (綠 #10b981)
   *   1,500 ~ 3,600 -> 普通 (黃 #eab308)
   *   3,600 ~ 6,000 -> 對敏感族群不健康 (橘 #f97316)
   *   6,000 ~ 15,000-> 對所有族群不健康 (紅 #ef4444)
   *   > 15,000      -> 非常不健康 (紫 #a855f7)
   */
  const getLevelInfo = (val: number) => {
    if (val === undefined || val === null || val <= 0) {
      return { label: '無資料', color: 'rgba(30, 41, 59, 0.4)', textClass: 'text-slate-500' };
    }

    if (isPm25) {
      if (val <= 12.4) {
        return { label: '良好 (0~12.4)', color: '#10b981', textClass: 'text-emerald-400' };
      }
      if (val <= 30.4) {
        return { label: '普通 (12.5~30.4)', color: '#eab308', textClass: 'text-yellow-400' };
      }
      if (val <= 50.4) {
        return { label: '對敏感族群不健康 (30.5~50.4)', color: '#f97316', textClass: 'text-orange-400' };
      }
      if (val <= 125.4) {
        return { label: '對所有族群不健康 (50.5~125.4)', color: '#ef4444', textClass: 'text-red-400' };
      }
      return { label: '非常不健康 (>125.4)', color: '#a855f7', textClass: 'text-purple-400' };
    } else {
      // TVOC (按比例以 15,000 為上限)
      if (val <= 1500) {
        return { label: '良好 (0~1,500)', color: '#10b981', textClass: 'text-emerald-400' };
      }
      if (val <= 3600) {
        return { label: '普通 (1,500~3,600)', color: '#eab308', textClass: 'text-yellow-400' };
      }
      if (val <= 6000) {
        return { label: '對敏感族群不健康 (3,600~6,000)', color: '#f97316', textClass: 'text-orange-400' };
      }
      if (val <= 15000) {
        return { label: '對所有族群不健康 (6,000~15,000)', color: '#ef4444', textClass: 'text-red-400' };
      }
      return { label: '非常不健康 (>15,000)', color: '#a855f7', textClass: 'text-purple-400' };
    }
  };

  if (!matrix || matrix.length < 7) {
    return (
      <div className="w-full h-80 bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-center text-slate-500">
        該園區尚無週時段熱力矩陣數據
      </div>
    );
  }

  // 尋找最高濃度時段以提供稽查建議
  let peakDay = 0;
  let peakHour = 0;
  let peakVal = 0;
  matrix.forEach((row, d) => {
    row.forEach((val, h) => {
      if (val > peakVal) {
        peakVal = val;
        peakDay = d;
        peakHour = h;
      }
    });
  });

  return (
    <div className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl backdrop-blur-md">
      {/* 標題與說明列 */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>📅 {zoneName} — 星期 × 時段 {isPm25 ? 'PM2.5 空污' : 'TVOC 異味'} 週期熱力矩陣</span>
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              7 天 × 24 小時長期特徵
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            統計 432 天全時段聚合平均，顏色採用標準空氣品質指標 (AQI) 5 級色階（{isPm25 ? '上限值 125.4 μg/m³' : '上限值 15,000 ppb'}）。
          </p>
        </div>

        {/* 右側：指標切換按鈕 + 色階圖例 */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 切換按鈕 */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center shrink-0">
            <button
              onClick={() => handleMetricChange('pm25')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                isPm25 
                  ? 'bg-orange-500 text-white shadow' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wind size={13} />
              PM2.5 (上限125.4)
            </button>
            <button
              onClick={() => handleMetricChange('voc')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                !isPm25 
                  ? 'bg-purple-600 text-white shadow' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame size={13} />
              TVOC (上限15000)
            </button>
          </div>

          {/* 5 級色階圖例 */}
          <div className="flex items-center gap-1.5 text-[11px] bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#10b981]" />
              <span className="text-slate-300">良好</span>
            </div>
            <div className="flex items-center gap-1 ml-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#eab308]" />
              <span className="text-slate-300">普通</span>
            </div>
            <div className="flex items-center gap-1 ml-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#f97316]" />
              <span className="text-slate-300">敏感不健康</span>
            </div>
            <div className="flex items-center gap-1 ml-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#ef4444]" />
              <span className="text-slate-300">所有不健康</span>
            </div>
            <div className="flex items-center gap-1 ml-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#a855f7]" />
              <span className="text-slate-300">非常不健康</span>
            </div>
          </div>
        </div>
      </div>

      {/* 熱力圖表格本體 */}
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[700px]">
          {/* 小時軸頂部標籤 */}
          <div className="grid grid-cols-[80px_repeat(24,1fr)] text-[10px] text-slate-400 mb-1.5 font-mono text-center">
            <div className="text-left pl-1">時段 →</div>
            {HOURS.map((h, i) => (
              <div key={h} className={i % 3 === 0 ? 'text-slate-300 font-semibold' : 'text-slate-600'}>
                {i % 3 === 0 ? `${i}h` : ''}
              </div>
            ))}
          </div>

          {/* 7 天列 */}
          {WEEKDAYS.map((dayName, dIdx) => (
            <div key={dayName} className="grid grid-cols-[80px_repeat(24,1fr)] gap-1 mb-1 items-center">
              <span className="text-xs font-medium text-slate-400 truncate pl-1">
                {dayName.slice(0, 2)}
              </span>
              {matrix[dIdx].map((val, hIdx) => {
                const isHovered = hoveredCell?.day === dIdx && hoveredCell?.hour === hIdx;
                const isPeak = dIdx === peakDay && hIdx === peakHour;
                const level = getLevelInfo(val);

                return (
                  <div
                    key={hIdx}
                    onMouseEnter={() => setHoveredCell({ day: dIdx, hour: hIdx, val })}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{ backgroundColor: level.color }}
                    className={`h-7 rounded transition-all duration-150 cursor-pointer relative flex items-center justify-center ${
                      isHovered ? 'ring-2 ring-white scale-110 z-10' : ''
                    } ${isPeak ? 'ring-2 ring-amber-300 animate-pulse' : ''}`}
                    title={`${WEEKDAYS[dIdx]} ${HOURS[hIdx]}: ${val?.toFixed(1) || 0} ${unit} (${level.label})`}
                  >
                    {isPeak && (
                      <span className="text-[10px] text-white font-bold drop-shadow">★</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 下方即時 Hover 資訊與稽查洞察 */}
      <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
        <div className="text-slate-300">
          {hoveredCell ? (
            <span className="flex items-center gap-2">
              <span>🔍 <b>{WEEKDAYS[hoveredCell.day]} {HOURS[hoveredCell.hour]}</b> ：</span>
              <span>平均濃度 <b className="text-white font-mono text-sm">{hoveredCell.val?.toFixed(2) || '--'}</b> {unit}</span>
              <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${getLevelInfo(hoveredCell.val).textClass} bg-slate-950 border border-slate-800`}>
                {getLevelInfo(hoveredCell.val).label}
              </span>
            </span>
          ) : (
            <span className="text-slate-500">將滑鼠懸停於方格上查看指定時段數值與 AQI 級別</span>
          )}
        </div>

        <div className="bg-amber-950/40 border border-amber-800/50 px-3 py-1 rounded text-amber-300 flex items-center gap-1.5">
          <span>⚡ <b>潛勢高峰時段：</b></span>
          <span>
            {WEEKDAYS[peakDay].slice(0, 2)} {HOURS[peakHour]} (均值 {peakVal.toFixed(1)} {unit}) 為歷史高好發期，建議鎖定夜間加強稽查
          </span>
        </div>
      </div>
    </div>
  );
};
