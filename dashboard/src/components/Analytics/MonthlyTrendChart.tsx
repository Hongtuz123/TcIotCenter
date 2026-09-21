'use client';

import React from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

interface MonthItem {
  month: string;
  pm25_mean: number;
  pm25_p95: number;
  exceed_pm25_count: number;
  voc_mean: number;
  voc_p95: number;
  exceed_voc_count: number;
}

interface MonthlyTrendChartProps {
  monthlyData: MonthItem[];
  metric: 'pm25' | 'voc';
  zoneName: string;
}

export const MonthlyTrendChart: React.FC<MonthlyTrendChartProps> = ({
  monthlyData,
  metric,
  zoneName
}) => {
  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';

  const categories = monthlyData.map(d => d.month);
  const meanSeries = monthlyData.map(d => isPm25 ? d.pm25_mean : d.voc_mean);
  const exceedSeries = monthlyData.map(d => isPm25 ? d.exceed_pm25_count : d.exceed_voc_count);

  const options: Highcharts.Options = {
    chart: {
      backgroundColor: 'transparent',
      height: 320,
      style: {
        fontFamily: "'Inter', 'Noto Sans TC', sans-serif"
      }
    },
    title: {
      text: `${zoneName} — 歷史月度趨勢與超標時數 (2025~2026)`,
      align: 'left',
      style: {
        color: '#f8fafc',
        fontSize: '14px',
        fontWeight: '600'
      }
    },
    xAxis: {
      categories: categories,
      crosshair: true,
      labels: {
        style: { color: '#cbd5e1', fontSize: '11px' },
        rotation: -30
      },
      lineColor: '#334155'
    },
    yAxis: [
      {
        // 主軸：濃度
        title: {
          text: `平均濃度 (${unit})`,
          style: { color: isPm25 ? '#f97316' : '#a855f7', fontSize: '11px' }
        },
        labels: {
          style: { color: isPm25 ? '#f97316' : '#a855f7' }
        },
        gridLineColor: 'rgba(51, 65, 85, 0.4)'
      },
      {
        // 次軸：超標時數
        title: {
          text: '超標總次數',
          style: { color: '#ef4444', fontSize: '11px' }
        },
        labels: {
          style: { color: '#ef4444' }
        },
        opposite: true,
        gridLineWidth: 0
      }
    ],
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      borderColor: '#475569',
      borderRadius: 8,
      shared: true,
      useHTML: true,
      headerFormat: '<div style="font-size:12px;font-weight:bold;color:#f8fafc;margin-bottom:4px;">{point.key} 月</div>',
      style: { color: '#e2e8f0' }
    },
    legend: {
      itemStyle: { color: '#94a3b8', fontSize: '11px' },
      align: 'right',
      verticalAlign: 'top'
    },
    credits: { enabled: false },
    series: [
      {
        name: '平均濃度',
        type: 'spline',
        data: meanSeries,
        yAxis: 0,
        color: isPm25 ? '#f97316' : '#a855f7',
        lineWidth: 3,
        marker: {
          radius: 4,
          fillColor: isPm25 ? '#f97316' : '#a855f7'
        },
        tooltip: {
          valueSuffix: ` ${unit}`
        }
      },
      {
        name: '超標小時次數',
        type: 'column',
        data: exceedSeries,
        yAxis: 1,
        color: 'rgba(239, 68, 68, 0.4)',
        borderColor: '#ef4444',
        borderRadius: 3,
        tooltip: {
          valueSuffix: ' 次'
        }
      }
    ]
  };

  if (!monthlyData || monthlyData.length === 0) {
    return (
      <div className="w-full h-80 bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-center text-slate-500">
        該園區尚無月份統計數據
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-xl backdrop-blur-md">
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  );
};
