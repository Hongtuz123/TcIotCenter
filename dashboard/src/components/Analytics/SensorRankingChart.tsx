'use client';

import React, { useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

interface SensorItem {
  deviceId: number;
  name: string;
  lat: number;
  lon: number;
  pm25_mean: number;
  pm25_p95: number;
  pm25_max: number;
  exceed_pm25_count: number;
  voc_mean: number;
  voc_p95: number;
  voc_max: number;
  exceed_voc_count: number;
  count: number;
}

interface SensorRankingChartProps {
  sensors: SensorItem[];
  metric: 'pm25' | 'voc';
  zoneName: string;
  onSelectSensor?: (sensor: SensorItem) => void;
}

export const SensorRankingChart: React.FC<SensorRankingChartProps> = ({
  sensors,
  metric,
  zoneName,
  onSelectSensor
}) => {
  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';

  const sortedSensors = useMemo(() => {
    if (!sensors || sensors.length === 0) return [];
    return [...sensors]
      .sort((a, b) => {
        const valA = isPm25 ? (a.pm25_mean || 0) : (a.voc_mean || 0);
        const valB = isPm25 ? (b.pm25_mean || 0) : (b.voc_mean || 0);
        return valB - valA;
      })
      .slice(0, 10); // 取前 10 站
  }, [sensors, isPm25]);

  const categories = sortedSensors.map(s => s.name || `ID:${s.deviceId}`);
  const meanData = sortedSensors.map(s => isPm25 ? s.pm25_mean : s.voc_mean);
  const p95Data = sortedSensors.map(s => isPm25 ? s.pm25_p95 : s.voc_p95);

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      backgroundColor: 'transparent',
      height: 320,
      style: {
        fontFamily: "'Inter', 'Noto Sans TC', sans-serif"
      }
    },
    title: {
      text: `${zoneName} — 微型感測器 ${isPm25 ? 'PM2.5' : 'TVOC'} 濃度排行 (Top 10)`,
      align: 'left',
      style: {
        color: '#f8fafc',
        fontSize: '14px',
        fontWeight: '600'
      }
    },
    xAxis: {
      categories: categories,
      labels: {
        style: { color: '#cbd5e1', fontSize: '11px' }
      },
      lineColor: '#334155'
    },
    yAxis: {
      min: 0,
      title: {
        text: `濃度 (${unit})`,
        style: { color: '#94a3b8', fontSize: '11px' }
      },
      labels: { style: { color: '#94a3b8' } },
      gridLineColor: 'rgba(51, 65, 85, 0.4)',
      plotLines: [
        {
          value: isPm25 ? 50.4 : 500,
          color: '#ef4444',
          width: 1.5,
          dashStyle: 'ShortDash',
          zIndex: 5,
          label: {
            text: isPm25 ? '警戒門檻 50.4 μg/m³' : '警戒門檻 500 ppb',
            align: 'right',
            style: { color: '#ef4444', fontSize: '10px' }
          }
        }
      ]
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#475569',
      borderRadius: 8,
      shared: true,
      useHTML: true,
      headerFormat: '<div style="font-size:12px;font-weight:bold;color:#f8fafc;margin-bottom:4px;">站點: {point.key}</div>',
      pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y}</b> ' + unit + '<br/>',
      style: { color: '#e2e8f0' }
    },
    plotOptions: {
      column: {
        borderRadius: 4,
        cursor: 'pointer',
        point: {
          events: {
            click: function() {
              const item = sortedSensors[this.index];
              if (item && onSelectSensor) onSelectSensor(item);
            }
          }
        }
      }
    },
    legend: {
      itemStyle: { color: '#94a3b8', fontSize: '11px' },
      align: 'right',
      verticalAlign: 'top'
    },
    credits: { enabled: false },
    series: [
      {
        type: 'column',
        name: '平均濃度',
        data: meanData,
        color: isPm25 ? '#38bdf8' : '#e879f9'
      },
      {
        type: 'column',
        name: 'P95 極端值',
        data: p95Data,
        color: isPm25 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(232, 121, 249, 0.35)'
      }
    ]
  };

  if (!sensors || sensors.length === 0) {
    return (
      <div className="w-full h-80 bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-center text-slate-500">
        該園區尚無微型感測器數據
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-xl backdrop-blur-md">
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  );
};
