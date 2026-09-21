'use client';

import React, { useState, useEffect, useMemo } from 'react';
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

// 顏色線性插值輔助函式
function interpolateRgb(
  c1: [number, number, number],
  c2: [number, number, number],
  factor: number
): string {
  const f = Math.max(0, Math.min(1, factor));
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

export const WeekdayHourHeatmap: React.FC<WeekdayHourHeatmapProps> = ({
  data,
  metric: initialMetric,
  zoneName,
  onToggleMetric
}) => {
  const [internalMetric, setInternalMetric] = useState<'pm25' | 'voc'>(initialMetric);
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number; val: number } | null>(null);

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
   * 官方 AQI 級距與顏色錨點（支援連續漸層插值）：
   *
   * PM2.5（上限設為 125.4）:
   *   0.0   -> 綠色 (16, 185, 129)
   *   12.4  -> 黃綠 (84, 196, 75)
   *   30.4  -> 琥珀黃 (234, 179, 8)
   *   50.4  -> 警告橘 (249, 115, 22)
   *   125.4 -> 烈焰紅 (239, 68, 68)
   *   >125.4-> 極重紫 (168, 85, 247)
   *
   * TVOC（等比例對齊，上限設為 15,000）:
   *   0     -> 綠色 (16, 185, 129)
   *   1,500 -> 黃綠 (84, 196, 75)
   *   3,600 -> 琥珀黃 (234, 179, 8)
   *   6,000 -> 警告橘 (249, 115, 22)
   *   15,000-> 烈焰紅 (239, 68, 68)
   *   >15,000-> 極重紫 (168, 85, 247)
   */
  const scaleStops = useMemo(() => {
    if (isPm25) {
      return [
        { val: 0, rgb: [16, 185, 129] as [number, number, number] },    // 良好綠
        { val: 12.4, rgb: [74, 222, 128] as [number, number, number] }, // 良好頂端
        { val: 30.4, rgb: [234, 179, 8] as [number, number, number] },  // 普通黃
        { val: 50.4, rgb: [249, 115, 22] as [number, number, number] }, // 敏感橘
        { val: 125.4, rgb: [239, 68, 68] as [number, number, number] },// 所有不健康紅
        { val: 160.0, rgb: [168, 85, 247] as [number, number, number] } // 非常不健康紫
      ];
    } else {
      return [
        { val: 0, rgb: [16, 185, 129] as [number, number, number] },
        { val: 1500, rgb: [74, 222, 128] as [number, number, number] },
        { val: 3600, rgb: [234, 179, 8] as [number, number, number] },
        { val: 6000, rgb: [249, 115, 22] as [number, number, number] },
        { val: 15000, rgb: [239, 68, 68] as [number, number, number] },
        { val: 20000, rgb: [168, 85, 247] as [number, number, number] }
      ];
    }
  }, [isPm25]);

  // 連續漸層著色函式
  const getColor = (val: number): string => {
    if (val === undefined || val === null || val <= 0) {
      return 'rgba(30, 41, 59, 0.4)';
    }

    // 處理低於最低值
    if (val <= scaleStops[0].val) {
      return `rgb(${scaleStops[0].rgb.join(',')})`;
    }

    // 尋找對應區間進行線性插值
    for (let i = 0; i < scaleStops.length - 1; i++) {
      const s1 = scaleStops[i];
      const s2 = scaleStops[i + 1];
      if (val >= s1.val && val <= s2.val) {
        const factor = (val - s1.val) / (s2.val - s1.val || 1);
        return interpolateRgb(s1.rgb, s2.rgb, factor);
      }
    }

    // 高於最高錨點
    return `rgb(${scaleStops[scaleStops.length - 1].rgb.join(',')})`;
  };

  // 取得等級文字標籤
  const getLevelInfo = (val: number) => {
    if (val === undefined || val === null || val <= 0) {
      return { label: '無資料', textClass: 'text-slate-500' };
    }
    if (isPm25) {
      if (val <= 12.4) return { label: '良好', textClass: 'text-emerald-400' };
      if (val <= 30.4) return { label: '普通', textClass: 'text-yellow-400' };
      if (val <= 50.4) return { label: '對敏感族群不健康', textClass: 'text-orange-400' };
      if (val <= 125.4) return { label: '對所有族群不健康', textClass: 'text-red-400' };
      return { label: '非常不健康', textClass: 'text-purple-400' };
    } else {
      if (val <= 1500) return { label: '良好', textClass: 'text-emerald-400' };
      if (val <= 3600) return { label: '普通', textClass: 'text-yellow-400' };
      if (val <= 6000) return { label: '對敏感族群不健康', textClass: 'text-orange-400' };
      if (val <= 15000) return { label: '對所有族群不健康', textClass: 'text-red-400' };
      return { label: '非常不健康', textClass: 'text-purple-400' };
    }
  };

  // 計算滑鼠 Hover 時在 Scale Bar 上的百分比位置 (0% ~ 100%)
  const hoverIndicatorPercent = useMemo(() => {
    if (!hoveredCell || hoveredCell.val <= 0) return null;
    const maxBound = isPm25 ? 125.4 : 15000;
    const pct = (hoveredCell.val / maxBound) * 100;
    return Math.min(Math.max(pct, 0), 100);
  }, [hoveredCell, isPm25]);

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
      {/* ── 頂部標題與 Scale Bar 工具列 ── */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-5 gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>📅 {zoneName} — 星期 × 時段 {isPm25 ? 'PM2.5 空污' : 'TVOC 異味'} 週期熱力矩陣</span>
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              7 天 × 24 小時長期特徵
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            統計 432 天全時段聚合平均，顏色採用標準空氣品質指標 (AQI) 連續色階（{isPm25 ? '最高值 125.4 μg/m³' : '最高值 15,000 ppb'}）。
          </p>
        </div>

        {/* 右側：指標切換按鈕 + 專業 Scale Bar */}
        <div className="flex flex-wrap items-center gap-4">
          {/* 指標切換按鈕 */}
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
              PM2.5 (125.4)
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
              TVOC (15000)
            </button>
          </div>

          {/* 專業連續漸變 Scale Bar 容器 */}
          <div className="bg-slate-950/80 px-3.5 py-2 rounded-xl border border-slate-800 flex flex-col justify-center min-w-[280px]">
            {/* 標題與單位 */}
            <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1 font-medium">
              <span>{isPm25 ? 'PM2.5 濃度 Scale Bar' : 'TVOC 濃度 Scale Bar'}</span>
              <span className="font-mono text-slate-500">({unit})</span>
            </div>

            {/* 色階色帶 (帶有滑鼠指針 Indicator) */}
            <div className="relative w-full h-3 rounded-full overflow-hidden shadow-inner">
              <div
                className="w-full h-full"
                style={{
                  background: isPm25
                    ? 'linear-gradient(to right, #10b981 0%, #4ade80 10%, #eab308 24%, #f97316 40%, #ef4444 100%, #a855f7 100%)'
                    : 'linear-gradient(to right, #10b981 0%, #4ade80 10%, #eab308 24%, #f97316 40%, #ef4444 100%, #a855f7 100%)'
                }}
              />
              {/* 當 Hover 時在 Scale Bar 上顯示的指針標記 */}
              {hoverIndicatorPercent !== null && (
                <div
                  className="absolute top-0 bottom-0 w-1.5 bg-white border border-slate-900 rounded shadow-md transform -translate-x-1/2 transition-all duration-75"
                  style={{ left: `${hoverIndicatorPercent}%` }}
                />
              )}
            </div>

            {/* 刻度標籤數值 */}
            <div className="flex justify-between text-[9px] font-mono text-slate-400 mt-1">
              {isPm25 ? (
                <>
                  <span>0</span>
                  <span>12.4</span>
                  <span>30.4</span>
                  <span>50.4</span>
                  <span className="font-bold text-rose-400">125.4</span>
                  <span className="text-purple-400">+</span>
                </>
              ) : (
                <>
                  <span>0</span>
                  <span>1.5k</span>
                  <span>3.6k</span>
                  <span>6.0k</span>
                  <span className="font-bold text-rose-400">15k</span>
                  <span className="text-purple-400">+</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 熱力圖矩陣表格本體 ── */}
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
                const cellColor = getColor(val);
                const level = getLevelInfo(val);

                return (
                  <div
                    key={hIdx}
                    onMouseEnter={() => setHoveredCell({ day: dIdx, hour: hIdx, val })}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{ backgroundColor: cellColor }}
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

      {/* ── 下方 Hover 即時數值資訊與稽查洞察 ── */}
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
            <span className="text-slate-500">將滑鼠懸停於方格上，右上角 Scale Bar 將動態標示數值落點</span>
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
