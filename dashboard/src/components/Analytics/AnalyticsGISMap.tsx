'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Flame, Wind, Layers, Maximize2 } from 'lucide-react';

interface ZoneRankingItem {
  zone: string;
  pm25_mean: number;
  pm25_p95: number;
  voc_mean: number;
  voc_p95: number;
  potency_score?: number;
}

interface SensorRankingItem {
  deviceId: number;
  name: string;
  lat: number;
  lon: number;
  pm25_mean: number;
  pm25_p95: number;
  voc_mean: number;
  voc_p95: number;
}

interface AnalyticsGISMapProps {
  zoneSummary: ZoneRankingItem[];
  sensorSummary: { [zoneName: string]: SensorRankingItem[] };
  selectedZone: string;
  onSelectZone: (zone: string) => void;
  metric: 'pm25' | 'voc';
  onChangeMetric: (metric: 'pm25' | 'voc') => void;
  selectedMonth: string;
}

export const AnalyticsGISMap: React.FC<AnalyticsGISMapProps> = ({
  zoneSummary,
  sensorSummary,
  selectedZone,
  onSelectZone,
  metric,
  onChangeMetric,
  selectedMonth
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showSensors, setShowSensors] = useState(true);

  const isPm25 = metric === 'pm25';
  const unit = isPm25 ? 'μg/m³' : 'ppb';
  const token = (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '');

  // 1. 初始化地圖
  useEffect(() => {
    if (!mapContainerRef.current || !token) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [120.62, 24.22], // 臺中產業廊道中心視角
      zoom: 10.5,
      pitch: 35
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      setIsLoaded(true);

      // 載入 20 園區 GeoJSON
      fetch('/industrial-zones.geojson')
        .then(res => res.json())
        .then(geojson => {
          if (!map.getSource('analytics-zones')) {
            map.addSource('analytics-zones', {
              type: 'geojson',
              data: geojson
            });

            // 園區多邊形填色
            map.addLayer({
              id: 'analytics-zones-fill',
              type: 'fill',
              source: 'analytics-zones',
              paint: {
                'fill-color': '#f97316',
                'fill-opacity': 0.25
              }
            });

            // 園區邊框
            map.addLayer({
              id: 'analytics-zones-line',
              type: 'line',
              source: 'analytics-zones',
              paint: {
                'line-color': '#fdba74',
                'line-width': 2
              }
            });

            // 園區名稱標籤
            map.addLayer({
              id: 'analytics-zones-label',
              type: 'symbol',
              source: 'analytics-zones',
              layout: {
                'text-field': ['get', 'name'],
                'text-size': 11,
                'text-anchor': 'center',
                'text-allow-overlap': false
              },
              paint: {
                'text-color': '#f8fafc',
                'text-halo-color': '#020617',
                'text-halo-width': 1.5
              }
            });

            // 點擊園區事件
            map.on('click', 'analytics-zones-fill', (e) => {
              if (e.features && e.features[0]) {
                const zName = e.features[0].properties?.name;
                if (zName) onSelectZone(zName);
              }
            });

            map.on('mouseenter', 'analytics-zones-fill', () => {
              map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'analytics-zones-fill', () => {
              map.getCanvas().style.cursor = '';
            });
          }
        });
    });

    return () => {
      map.remove();
    };
  }, [token]);

  // 2. 當園區數據或選定指標改變時，動態更新園區與感測器站點視覺
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    // 建立園區濃度顏色映射表
    const zoneColorMap: { [name: string]: string } = {};
    const maxVal = Math.max(...zoneSummary.map(z => isPm25 ? (z.pm25_mean || 0) : (z.voc_mean || 0)), 1);

    zoneSummary.forEach(z => {
      const val = isPm25 ? (z.pm25_mean || 0) : (z.voc_mean || 0);
      const ratio = Math.min(val / maxVal, 1);
      if (isPm25) {
        // PM2.5 漸層 (青綠 -> 黃 -> 橘 -> 烈紅)
        if (ratio < 0.3) zoneColorMap[z.zone] = 'rgba(34, 197, 94, 0.35)';
        else if (ratio < 0.6) zoneColorMap[z.zone] = 'rgba(234, 179, 8, 0.45)';
        else if (ratio < 0.8) zoneColorMap[z.zone] = 'rgba(249, 115, 22, 0.55)';
        else zoneColorMap[z.zone] = 'rgba(239, 68, 68, 0.65)';
      } else {
        // TVOC 漸層 (靛青 -> 紫 -> 洋紅)
        if (ratio < 0.3) zoneColorMap[z.zone] = 'rgba(99, 102, 241, 0.35)';
        else if (ratio < 0.6) zoneColorMap[z.zone] = 'rgba(168, 85, 247, 0.45)';
        else if (ratio < 0.8) zoneColorMap[z.zone] = 'rgba(217, 70, 239, 0.55)';
        else zoneColorMap[z.zone] = 'rgba(244, 63, 94, 0.65)';
      }
    });

    if (map.getLayer('analytics-zones-fill')) {
      const matchExpr: any[] = ['match', ['get', 'name']];
      Object.entries(zoneColorMap).forEach(([name, color]) => {
        matchExpr.push(name, color);
      });
      matchExpr.push('rgba(148, 163, 184, 0.2)'); // 預設

      map.setPaintProperty('analytics-zones-fill', 'fill-color', matchExpr);
    }

    // 更新站點 GeoJSON
    const sensorFeatures: any[] = [];
    Object.entries(sensorSummary).forEach(([zName, sList]) => {
      sList.forEach(s => {
        const val = isPm25 ? s.pm25_mean : s.voc_mean;
        sensorFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [s.lon, s.lat]
          },
          properties: {
            deviceId: s.deviceId,
            name: s.name,
            zone: zName,
            value: val,
            isSelectedZone: zName === selectedZone
          }
        });
      });
    });

    const sensorGeoJSON = {
      type: 'FeatureCollection',
      features: sensorFeatures
    };

    if (map.getSource('analytics-sensors')) {
      (map.getSource('analytics-sensors') as mapboxgl.GeoJSONSource).setData(sensorGeoJSON as any);
    } else {
      map.addSource('analytics-sensors', {
        type: 'geojson',
        data: sensorGeoJSON as any
      });

      // 感測器圓圈
      map.addLayer({
        id: 'analytics-sensors-circle',
        type: 'circle',
        source: 'analytics-sensors',
        paint: {
          'circle-radius': [
            'case',
            ['get', 'isSelectedZone'],
            7,
            4
          ],
          'circle-color': isPm25 ? '#f97316' : '#c084fc',
          'circle-stroke-width': [
            'case',
            ['get', 'isSelectedZone'],
            2,
            1
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.85
        }
      });

      // 點擊站點
      map.on('click', 'analytics-sensors-circle', (e) => {
        if (e.features && e.features[0]) {
          const props = e.features[0].properties;
          if (props?.zone) onSelectZone(props.zone);
        }
      });
    }

    if (map.getLayer('analytics-sensors-circle')) {
      map.setLayoutProperty('analytics-sensors-circle', 'visibility', showSensors ? 'visible' : 'none');
      map.setPaintProperty('analytics-sensors-circle', 'circle-color', isPm25 ? '#f97316' : '#c084fc');
    }
  }, [zoneSummary, sensorSummary, selectedZone, metric, isLoaded, isPm25, showSensors]);

  // 3. 當選定園區切換時，地圖平滑平移至該園區
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedZone || !sensorSummary[selectedZone] || sensorSummary[selectedZone].length === 0) return;

    const sensors = sensorSummary[selectedZone];
    const avgLat = sensors.reduce((acc, s) => acc + s.lat, 0) / sensors.length;
    const avgLon = sensors.reduce((acc, s) => acc + s.lon, 0) / sensors.length;

    map.flyTo({
      center: [avgLon, avgLat],
      zoom: 12.8,
      duration: 1200
    });
  }, [selectedZone, sensorSummary]);

  return (
    <div className="relative w-full h-[480px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* 頂部切換工具列 */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-lg border border-slate-700/80 shadow-lg">
        {/* 指標切換按鈕 */}
        <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800">
          <button
            onClick={() => onChangeMetric('pm25')}
            className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-all ${
              isPm25 ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wind size={13} />
            PM2.5 空污熱區
          </button>
          <button
            onClick={() => onChangeMetric('voc')}
            className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-all ${
              !isPm25 ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame size={13} />
            TVOC 異味熱區
          </button>
        </div>

        {/* 顯示站點開關 */}
        <button
          onClick={() => setShowSensors(!showSensors)}
          className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1 border transition-all ${
            showSensors 
              ? 'bg-slate-800 text-slate-200 border-slate-700' 
              : 'bg-transparent text-slate-500 border-slate-800'
          }`}
        >
          <Layers size={13} />
          {showSensors ? '微感器: 顯示' : '微感器: 隱藏'}
        </button>
      </div>

      {/* 當前焦點資訊提示 */}
      <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-lg border border-slate-800 text-xs text-slate-300">
        <span className="text-slate-500">目前焦點：</span>
        <b className="text-orange-400 ml-1">{selectedZone}</b>
        <span className="text-slate-500 ml-2">({unit})</span>
      </div>

      {/* 地圖容器 */}
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};
