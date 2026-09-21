'use client';

import React, { useState, useMemo } from 'react';

interface WeekdayHourHeatmapProps {
  data: {
    pm25: number[][]; // [7][24]
    voc: number[][];  // [7][24]
  };
  metric: 'pm25' | 'voc';
  zoneName: string;
}

const WEEKDAYS = ['週一 (Mon)', '週二 (Tue)', '週三 (Wed)', '週四 (Thu)', '週五 (Fri)', '週六 (Sat)', '週日 (Sun)'];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

export const WeekdayHourHeatmap: React.FC<WeekdayHourHeatmapProps> = ({
  data,
  metric,
  zoneName
}) => {
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number; val: number } | null>(null);

  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';
  const matrix = isPm25 ? data?.pm25 : data?.voc;

  // 計算該指標的最大值與最小值以產生漸層色階
  const { maxVal, minVal } = useMemo(() => {
    if (!matrix || matrix.length === 0) return { maxVal: 50, minVal: 0 };
    let max = 0;
    let min = Infinity;
    matrix.forEach(row => {
      row.forEach(val => {
        if (val > max) max = val;
        if (val < min && val > 0) min = val;
      });
    });
    return { maxVal: max || 50, minVal: min === Infinity ? 0 : min };
  }, [matrix]);

  // 動態顏色計算 (依濃度從暗藍 -> 綠 -> 橘 -> 紅 -> 紫)
  const getColor = (val: number) => {
    if (!val || val <= 0) return 'rgba(30, 41, 59, 0.4)';
    const ratio = Math.min(Math.max((val - minVal) / (maxVal - minVal || 1), 0), 1);
    
    if (isPm25) {
      // PM2.5 漸層：低(深青/藍綠) -> 中(黃/橘) -> 高(大紅/紫)
      if (ratio < 0.25) return `rgba(34, 197, 94, ${0.35 + ratio * 0.8})`; // 綠
      if (ratio < 0.5) return `rgba(234, 179, 8, ${0.45 + ratio * 0.8})`;  // 黃
      if (ratio < 0.75) return `rgba(249, 115, 22, ${0.6 + ratio * 0.5})`; // 橘
      return `rgba(239, 68, 68, ${0.75 + ratio * 0.25})`;                 // 紅
    } else {
      // TVOC 漸層：低(深靛) -> 中(紫) -> 高(洋紅/粉紫)
      if (ratio < 0.25) return `rgba(99, 102, 241, ${0.35 + ratio * 0.8})`;
      if (ratio < 0.5) return `rgba(168, 85, 247, ${0.45 + ratio * 0.8})`;
      if (ratio < 0.75) return `rgba(217, 70, 239, ${0.6 + ratio * 0.5})`;
      return `rgba(244, 63, 94, ${0.75 + ratio * 0.25})`;
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
      {/* 標題與說明 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span>📅 {zoneName} — 星期 × 時段 {isPm25 ? 'PM2.5 空污' : 'TVOC 異味'} 週期熱力矩陣</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              7 天 × 24 小時長期特徵
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            統計 432 天全時段聚合平均，可精準捕捉規律性工廠夜間排放或上下班尖峰。
          </p>
        </div>

        {/* 色階圖例 */}
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 px-3 py-1.5 rounded-lg border border-slate-800">
          <span>低 ({minVal.toFixed(1)})</span>
          <div className="w-24 h-2.5 rounded-full bg-gradient-to-r from-emerald-600 via-amber-500 to-rose-600" />
          <span>高 ({maxVal.toFixed(1)} {unit})</span>
        </div>
      </div>

      {/* 熱力圖表格本體 */}
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[700px]">
          {/* 小時軸頂部標籤 */}
          <div className="grid grid-cols-[80px_repeat(24,1fr)] text-[10px] text-slate-400 mb-1 font-mono text-center">
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

                return (
                  <div
                    key={hIdx}
                    onMouseEnter={() => setHoveredCell({ day: dIdx, hour: hIdx, val })}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{ backgroundColor: getColor(val) }}
                    className={`h-7 rounded transition-all duration-150 cursor-pointer relative flex items-center justify-center ${
                      isHovered ? 'ring-2 ring-white scale-110 z-10' : ''
                    } ${isPeak ? 'ring-1 ring-amber-400 animate-pulse' : ''}`}
                    title={`${WEEKDAYS[dIdx]} ${HOURS[hIdx]}: ${val} ${unit}`}
                  >
                    {isPeak && (
                      <span className="text-[9px] text-amber-300 font-bold">★</span>
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
            <span>
              🔍 <b>{WEEKDAYS[hoveredCell.day]} {HOURS[hoveredCell.hour]}</b> ： 
              平均濃度 <b className="text-orange-400">{hoveredCell.val.toFixed(2)}</b> {unit}
            </span>
          ) : (
            <span className="text-slate-500">將滑鼠懸停於方格上查看指定時段數值</span>
          )}
        </div>

        <div className="bg-amber-950/40 border border-amber-800/50 px-3 py-1 rounded text-amber-300 flex items-center gap-1.5">
          <span>⚡ <b>潛勢高峰建議：</b></span>
          <span>
            {WEEKDAYS[peakDay].slice(0, 2)} {HOURS[peakHour]} ({peakVal.toFixed(1)} {unit}) 為歷史高好發期，建議鎖定加強查緝
          </span>
        </div>
      </div>
    </div>
  );
};
