'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Flame, Wind, Layers, Compass, Crosshair } from 'lucide-react';

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
  focusedSensor?: SensorRankingItem | null;
  onSelectSensor?: (sensor: SensorRankingItem) => void;
}

export const AnalyticsGISMap: React.FC<AnalyticsGISMapProps> = ({
  zoneSummary,
  sensorSummary,
  selectedZone,
  onSelectZone,
  metric,
  onChangeMetric,
  selectedMonth,
  focusedSensor,
  onSelectSensor
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const activePopupRef = useRef<mapboxgl.Popup | null>(null);
  const pulseMarkerRef = useRef<mapboxgl.Marker | null>(null);
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
      center: [120.62, 24.22],
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
                'fill-opacity': 0.22
              }
            });

            // 園區邊框 (虛線霓虹效果)
            map.addLayer({
              id: 'analytics-zones-line',
              type: 'line',
              source: 'analytics-zones',
              paint: {
                'line-color': '#fdba74',
                'line-width': 1.8,
                'line-dasharray': [3, 2]
              }
            });

            // 園區標籤
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

            // 點擊園區多邊形
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
      if (activePopupRef.current) activePopupRef.current.remove();
      if (pulseMarkerRef.current) pulseMarkerRef.current.remove();
      map.remove();
    };
  }, [token]);

  // 2. 當園區數據、選定指標或月份改變時，更新園區色彩與測站 AQI 5 級色階
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    // 園區多邊形色彩依據整體均值做 AQI 漸層賦色
    const zoneColorMap: { [name: string]: string } = {};
    zoneSummary.forEach(z => {
      const val = isPm25 ? (z.pm25_mean || 0) : (z.voc_mean || 0);
      if (isPm25) {
        if (val <= 12.4) zoneColorMap[z.zone] = 'rgba(16, 185, 129, 0.28)'; // 良好綠
        else if (val <= 30.4) zoneColorMap[z.zone] = 'rgba(234, 179, 8, 0.28)'; // 普通黃
        else if (val <= 50.4) zoneColorMap[z.zone] = 'rgba(249, 115, 22, 0.35)'; // 敏感橘
        else if (val <= 125.4) zoneColorMap[z.zone] = 'rgba(239, 68, 68, 0.42)'; // 不健康紅
        else zoneColorMap[z.zone] = 'rgba(168, 85, 247, 0.5)'; // 非常不健康紫
      } else {
        if (val <= 1500) zoneColorMap[z.zone] = 'rgba(16, 185, 129, 0.28)';
        else if (val <= 3600) zoneColorMap[z.zone] = 'rgba(234, 179, 8, 0.28)';
        else if (val <= 6000) zoneColorMap[z.zone] = 'rgba(249, 115, 22, 0.35)';
        else if (val <= 15000) zoneColorMap[z.zone] = 'rgba(239, 68, 68, 0.42)';
        else zoneColorMap[z.zone] = 'rgba(168, 85, 247, 0.5)';
      }
    });

    if (map.getLayer('analytics-zones-fill')) {
      const matchExpr: any[] = ['match', ['get', 'name']];
      Object.entries(zoneColorMap).forEach(([name, color]) => {
        matchExpr.push(name, color);
      });
      matchExpr.push('rgba(148, 163, 184, 0.15)');
      map.setPaintProperty('analytics-zones-fill', 'fill-color', matchExpr);
    }

    // 準備感測器站點 GeoJSON
    const sensorFeatures: any[] = [];
    Object.entries(sensorSummary).forEach(([zName, sList]) => {
      sList.forEach(s => {
        const val = isPm25 ? (s.pm25_mean || 0) : (s.voc_mean || 0);
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
            pm25_mean: s.pm25_mean,
            pm25_p95: s.pm25_p95,
            voc_mean: s.voc_mean,
            voc_p95: s.voc_p95,
            lat: s.lat,
            lon: s.lon,
            isSelectedZone: zName === selectedZone,
            isFocused: focusedSensor?.deviceId === s.deviceId
          }
        });
      });
    });

    const sensorGeoJSON = {
      type: 'FeatureCollection',
      features: sensorFeatures
    };

    /**
     * 官方 AQI 5 級色階 step 表達式：
     * PM2.5:
     *   0 ~ 12.4     -> #10b981 (綠)
     *   12.5 ~ 30.4  -> #eab308 (黃)
     *   30.5 ~ 50.4  -> #f97316 (橘)
     *   50.5 ~ 125.4 -> #ef4444 (紅)
     *   > 125.4      -> #a855f7 (紫)
     *
     * TVOC (等比例換算，以 15,000 為上限):
     *   0 ~ 1,500     -> #10b981 (綠)
     *   1,501 ~ 3,600 -> #eab308 (黃)
     *   3,601 ~ 6,000 -> #f97316 (橘)
     *   6,001 ~ 15,000-> #ef4444 (紅)
     *   > 15,000      -> #a855f7 (紫)
     */
    const circleColorExpression: any = isPm25
      ? [
          'step',
          ['get', 'value'],
          '#10b981',
          12.45,
          '#eab308',
          30.45,
          '#f97316',
          50.45,
          '#ef4444',
          125.45,
          '#a855f7'
        ]
      : [
          'step',
          ['get', 'value'],
          '#10b981',
          1500.5,
          '#eab308',
          3600.5,
          '#f97316',
          6000.5,
          '#ef4444',
          15000.5,
          '#a855f7'
        ];

    if (map.getSource('analytics-sensors')) {
      (map.getSource('analytics-sensors') as mapboxgl.GeoJSONSource).setData(sensorGeoJSON as any);
    } else {
      map.addSource('analytics-sensors', {
        type: 'geojson',
        data: sensorGeoJSON as any
      });

      // 感測器圖層 (圓圈)
      map.addLayer({
        id: 'analytics-sensors-circle',
        type: 'circle',
        source: 'analytics-sensors',
        paint: {
          'circle-color': circleColorExpression,
          'circle-radius': [
            'case',
            ['get', 'isSelectedZone'],
            7.5,
            4
          ],
          'circle-stroke-width': [
            'case',
            ['get', 'isSelectedZone'],
            2.2,
            1
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95
        }
      });

      // 點擊站點
      map.on('click', 'analytics-sensors-circle', (e) => {
        if (e.features && e.features[0]) {
          const props = e.features[0].properties as any;
          if (props) {
            if (onSelectSensor) {
              onSelectSensor({
                deviceId: props.deviceId,
                name: props.name,
                lat: props.lat,
                lon: props.lon,
                pm25_mean: props.pm25_mean,
                pm25_p95: props.pm25_p95,
                voc_mean: props.voc_mean,
                voc_p95: props.voc_p95
              });
            }
            if (props.zone && props.zone !== selectedZone) {
              onSelectZone(props.zone);
            }
          }
        }
      });

      map.on('mouseenter', 'analytics-sensors-circle', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'analytics-sensors-circle', () => {
        map.getCanvas().style.cursor = '';
      });
    }

    if (map.getLayer('analytics-sensors-circle')) {
      map.setLayoutProperty('analytics-sensors-circle', 'visibility', showSensors ? 'visible' : 'none');
      map.setPaintProperty('analytics-sensors-circle', 'circle-color', circleColorExpression);
      map.setPaintProperty('analytics-sensors-circle', 'circle-radius', [
        'case',
        ['get', 'isSelectedZone'],
        7.5,
        4
      ]);
    }
  }, [zoneSummary, sensorSummary, selectedZone, metric, isLoaded, isPm25, showSensors, focusedSensor]);

  // 3. 當選定園區改變時（且非點選單一測站觸發），平滑平移至園區中心
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedZone || !sensorSummary[selectedZone] || sensorSummary[selectedZone].length === 0) return;

    // 如果使用者剛剛點選的是特定測站，則由測站聚焦邏輯接管
    if (focusedSensor) return;

    const sensors = sensorSummary[selectedZone];
    const avgLat = sensors.reduce((acc, s) => acc + s.lat, 0) / sensors.length;
    const avgLon = sensors.reduce((acc, s) => acc + s.lon, 0) / sensors.length;

    map.flyTo({
      center: [avgLon, avgLat],
      zoom: 12.8,
      duration: 1200
    });
  }, [selectedZone, sensorSummary, focusedSensor]);

  // 4. 【核心動畫】：點選左下角微感器或地圖測站時，執行 GIS 3D 平滑飛入、雷達脈衝與 Popup 動畫
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedSensor) return;

    // 清除既有 Popup 與脈衝 Marker
    if (activePopupRef.current) activePopupRef.current.remove();
    if (pulseMarkerRef.current) pulseMarkerRef.current.remove();

    const targetCoords: [number, number] = [focusedSensor.lon, focusedSensor.lat];

    // 4.1 執行 3D 俯視平滑飛入動畫
    map.flyTo({
      center: targetCoords,
      zoom: 15.6,
      pitch: 52,
      bearing: -15,
      duration: 1600,
      essential: true
    });

    // 4.2 建立波紋雷達脈衝動畫 DOM 節點 (Radar Ping Spotlight)
    const el = document.createElement('div');
    el.className = 'relative flex items-center justify-center';
    el.innerHTML = `
      <div class="absolute w-12 h-12 rounded-full bg-orange-500/50 radar-ping"></div>
      <div class="absolute w-7 h-7 rounded-full bg-orange-400/70 animate-ping"></div>
      <div class="relative w-4 h-4 rounded-full bg-white border-2 border-orange-500 shadow-xl shadow-orange-500"></div>
    `;

    const pulseMarker = new mapboxgl.Marker({ element: el })
      .setLngLat(targetCoords)
      .addTo(map);
    pulseMarkerRef.current = pulseMarker;

    // 4.3 彈出精緻資訊卡片 (Popup)
    const val = isPm25 ? focusedSensor.pm25_mean : focusedSensor.voc_mean;
    const p95Val = isPm25 ? focusedSensor.pm25_p95 : focusedSensor.voc_p95;
    
    // 計算 AQI 標籤
    let badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    let badgeText = '良好';
    if (isPm25) {
      if (val > 125.4) { badgeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/30'; badgeText = '非常不健康'; }
      else if (val > 50.4) { badgeColor = 'bg-red-500/20 text-red-300 border-red-500/30'; badgeText = '對所有族群不健康'; }
      else if (val > 30.4) { badgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/30'; badgeText = '對敏感族群不健康'; }
      else if (val > 12.4) { badgeColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'; badgeText = '普通'; }
    } else {
      if (val > 15000) { badgeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/30'; badgeText = '非常不健康'; }
      else if (val > 6000) { badgeColor = 'bg-red-500/20 text-red-300 border-red-500/30'; badgeText = '對所有族群不健康'; }
      else if (val > 3600) { badgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/30'; badgeText = '對敏感族群不健康'; }
      else if (val > 1500) { badgeColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'; badgeText = '普通'; }
    }

    const popupHtml = `
      <div style="background:#0b111e;border:1px solid rgba(249,115,22,0.4);border-radius:12px;padding:12px 14px;min-width:180px;box-shadow:0 12px 28px rgba(0,0,0,0.6);font-family:sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1e293b;padding-bottom:6px;margin-bottom:8px;">
          <div style="font-weight:800;font-size:13px;color:#ffffff;display:flex;align-items:center;gap:4px;">
            <span>📍</span> <span>${focusedSensor.name}</span>
          </div>
          <span style="font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid;font-weight:600;" class="${badgeColor}">
            ${badgeText}
          </span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
          <div>
            <div style="color:#94a3b8;font-size:10px;">平均濃度</div>
            <div style="font-size:15px;font-weight:800;color:#f97316;">${val?.toFixed(2) || '--'} <span style="font-size:10px;color:#94a3b8;">${unit}</span></div>
          </div>
          <div>
            <div style="color:#94a3b8;font-size:10px;">P95 極端值</div>
            <div style="font-size:15px;font-weight:800;color:#cbd5e1;">${p95Val?.toFixed(2) || '--'} <span style="font-size:10px;color:#94a3b8;">${unit}</span></div>
          </div>
        </div>
        <div style="margin-top:8px;padding-top:6px;border-top:1px solid #1e293b;font-size:10px;color:#64748b;">
          所屬園區: <span style="color:#cbd5e1;font-weight:600;">${selectedZone}</span>
        </div>
      </div>
    `;

    const popup = new mapboxgl.Popup({
      offset: 20,
      closeButton: false,
      className: 'dark-sensor-popup'
    })
      .setLngLat(targetCoords)
      .setHTML(popupHtml)
      .addTo(map);

    activePopupRef.current = popup;
  }, [focusedSensor, isPm25, unit, selectedZone]);

  // 重設視角回到園區全貌
  const handleResetView = () => {
    const map = mapRef.current;
    if (!map || !selectedZone || !sensorSummary[selectedZone]) return;
    const sensors = sensorSummary[selectedZone];
    const avgLat = sensors.reduce((acc, s) => acc + s.lat, 0) / sensors.length;
    const avgLon = sensors.reduce((acc, s) => acc + s.lon, 0) / sensors.length;
    map.flyTo({
      center: [avgLon, avgLat],
      zoom: 12.8,
      pitch: 35,
      bearing: 0,
      duration: 1000
    });
  };

  return (
    <div className="relative w-full h-[480px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* ── 左上工具列：指標切換與開關 ── */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-lg border border-slate-700/80 shadow-lg">
        {/* 指標切換按鈕 */}
        <div className="flex bg-slate-950 p-0.5 rounded-md border border-slate-800">
          <button
            onClick={() => onChangeMetric('pm25')}
            className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              isPm25 ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wind size={13} />
            PM2.5 空污熱區
          </button>
          <button
            onClick={() => onChangeMetric('voc')}
            className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-all cursor-pointer ${
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
          className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1 border transition-all cursor-pointer ${
            showSensors 
              ? 'bg-slate-800 text-slate-200 border-slate-700' 
              : 'bg-transparent text-slate-500 border-slate-800'
          }`}
        >
          <Layers size={13} />
          {showSensors ? '微感器: 顯示' : '微感器: 隱藏'}
        </button>

        {/* 回到園區全覽 */}
        <button
          onClick={handleResetView}
          className="px-2 py-1 text-xs font-medium rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 transition-all cursor-pointer"
          title="重設視角回到園區全貌"
        >
          <Compass size={13} />
          全覽
        </button>
      </div>

      {/* ── 右下角：GIS 測站 AQI 5 級色階圖例 (Scale Bar) ── */}
      <div className="absolute bottom-3 right-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 text-[11px] shadow-xl">
        <div className="text-[10px] text-slate-400 mb-1 flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-300">測站 AQI 濃度色階 ({unit})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#10b981]" />
            <span className="text-slate-400">{isPm25 ? '0~12.4' : '0~1.5k'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#eab308]" />
            <span className="text-slate-400">{isPm25 ? '~30.4' : '~3.6k'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#f97316]" />
            <span className="text-slate-400">{isPm25 ? '~50.4' : '~6.0k'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
            <span className="text-slate-400">{isPm25 ? '~125.4' : '~15k'}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#a855f7]" />
            <span className="text-slate-400">{isPm25 ? '>125.4' : '>15k'}</span>
          </div>
        </div>
      </div>

      {/* ── 左下角：當前焦點資訊 ── */}
      <div className="absolute bottom-3 left-3 z-10 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-lg border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
        <span className="text-slate-500">園區：</span>
        <b className="text-orange-400">{selectedZone}</b>
        {focusedSensor && (
          <span className="flex items-center gap-1 text-sky-400 border-l border-slate-700 pl-2">
            <Crosshair size={12} />
            鎖定: <b>{focusedSensor.name}</b>
          </span>
        )}
      </div>

      {/* 地圖容器 */}
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};
