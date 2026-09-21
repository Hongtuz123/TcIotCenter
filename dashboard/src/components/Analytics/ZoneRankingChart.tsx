'use client';

import React, { useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

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

interface ZoneRankingChartProps {
  data: ZoneData[];
  metric: 'pm25' | 'voc';
  selectedZone: string;
  onSelectZone: (zone: string) => void;
  selectedMonth: string;
}

export const ZoneRankingChart: React.FC<ZoneRankingChartProps> = ({
  data,
  metric,
  selectedZone,
  onSelectZone,
  selectedMonth
}) => {
  const sortedData = useMemo(() => {
    return [...data]
      .sort((a, b) => {
        const valA = metric === 'pm25' ? (a.pm25_mean || 0) : (a.voc_mean || 0);
        const valB = metric === 'pm25' ? (b.pm25_mean || 0) : (b.voc_mean || 0);
        return valB - valA;
      })
      .slice(0, 15); // 前 15 大園區
  }, [data, metric]);

  const categories = sortedData.map(d => d.zone);
  const meanValues = sortedData.map(d => metric === 'pm25' ? d.pm25_mean : d.voc_mean);
  const p95Values = sortedData.map(d => metric === 'pm25' ? d.pm25_p95 : d.voc_p95);

  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';
  const titleText = isPm25 ? '全臺中工業園區 PM2.5 空污濃度排名' : '全臺中工業園區 TVOC 異味濃度排名';

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      backgroundColor: 'transparent',
      height: 480,
      style: {
        fontFamily: "'Inter', 'Noto Sans TC', sans-serif"
      }
    },
    title: {
      text: titleText,
      align: 'left',
      style: {
        color: '#f8fafc',
        fontSize: '15px',
        fontWeight: '600'
      }
    },
    subtitle: {
      text: selectedMonth === 'all' ? '涵蓋 432 天長期觀測平均' : `${selectedMonth} 月度觀測數據`,
      align: 'left',
      style: {
        color: '#94a3b8',
        fontSize: '12px'
      }
    },
    xAxis: {
      categories: categories,
      title: { text: undefined },
      labels: {
        style: {
          color: '#cbd5e1',
          fontSize: '12px'
        },
        formatter: function() {
          const name = String(this.value);
          const isSelected = name === selectedZone;
          return isSelected 
            ? `<span style="color:#f97316;font-weight:bold;">▶ ${name}</span>`
            : name;
        }
      },
      lineColor: '#334155',
      tickColor: '#334155'
    },
    yAxis: {
      min: 0,
      title: {
        text: `濃度數值 (${unit})`,
        align: 'high',
        style: { color: '#94a3b8', fontSize: '11px' }
      },
      labels: {
        overflow: 'justify',
        style: { color: '#94a3b8' }
      },
      gridLineColor: 'rgba(51, 65, 85, 0.4)',
      plotLines: isPm25 ? [
        {
          value: 35,
          color: '#ef4444',
          width: 1.5,
          dashStyle: 'ShortDash',
          zIndex: 5,
          label: {
            text: 'WHO/日均標準 35 μg/m³',
            align: 'right',
            style: { color: '#ef4444', fontSize: '10px' }
          }
        }
      ] : []
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      borderColor: '#475569',
      borderRadius: 8,
      shared: true,
      useHTML: true,
      headerFormat: '<div style="font-size:13px;font-weight:bold;color:#f8fafc;margin-bottom:4px;">{point.key}</div>',
      pointFormat: '<span style="color:{series.color};font-size:14px;">●</span> {series.name}: <b>{point.y}</b> ' + unit + '<br/>',
      valueSuffix: ` ${unit}`,
      style: { color: '#e2e8f0' }
    },
    plotOptions: {
      bar: {
        dataLabels: {
          enabled: true,
          style: {
            color: '#cbd5e1',
            textOutline: 'none',
            fontSize: '11px',
            fontWeight: 'normal'
          }
        },
        borderRadius: 4,
        cursor: 'pointer',
        point: {
          events: {
            click: function() {
              const clickedZone = categories[this.index];
              if (clickedZone) onSelectZone(clickedZone);
            }
          }
        }
      }
    },
    legend: {
      align: 'right',
      verticalAlign: 'top',
      itemStyle: { color: '#94a3b8', fontSize: '11px' },
      itemHoverStyle: { color: '#f8fafc' }
    },
    credits: { enabled: false },
    series: [
      {
        type: 'bar',
        name: '平均濃度',
        data: meanValues,
        color: isPm25 ? '#f97316' : '#a855f7'
      },
      {
        type: 'bar',
        name: 'P95 極端高值',
        data: p95Values,
        color: isPm25 ? 'rgba(249, 115, 22, 0.35)' : 'rgba(168, 85, 247, 0.35)'
      }
    ]
  };

  return (
    <div className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-xl backdrop-blur-md">
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  );
};
