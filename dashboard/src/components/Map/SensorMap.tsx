'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Sensor, Cluster, Observation, Event } from '@/types';
import { Layers, Flame, AlertTriangle, ShieldCheck, Compass } from 'lucide-react';

interface SensorMapProps {
  points: (Sensor & Observation)[];
  clusters: Cluster[];
  selectedSensorId: string | null;
  onSelectSensor: (sensorId: string) => void;
  onMapClickCoords?: (coords: { lat: number; lon: number }) => void;
  selectedClusterId: string | null;
  selectedFilter: { type: 'all' | 'county' | 'zone'; value: string };
  regionCenters: { [key: string]: [number, number] };
  selectedMetric: 'pm2_5' | 'temperature' | 'humidity';
  activeEvent?: Event | null;
  pm25Threshold?: number;
}

export const SensorMap: React.FC<SensorMapProps> = ({
  points,
  clusters,
  selectedSensorId,
  onSelectSensor,
  onMapClickCoords,
  selectedClusterId,
  selectedFilter,
  regionCenters,
  selectedMetric,
  activeEvent,
  pm25Threshold
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});
  const globalPopupRef = useRef<mapboxgl.Popup | null>(null);
  const isInternalClosingRef = useRef(false);
  const [mapStyle, setMapStyle] = useState<'dark-v11' | 'satellite-streets-v12' | 'streets-v12'>('dark-v11');
  const [isLoaded, setIsLoaded] = useState(false);
  const [showIndustrialZones, setShowIndustrialZones] = useState(true);
  const [showSensors, setShowSensors] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showBaseMapMenu, setShowBaseMapMenu] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [bearing, setBearing] = useState(0);
  const showIndustrialZonesRef = useRef(showIndustrialZones);
  const prevStyleRef = useRef(mapStyle);
  // 追蹤上一次篩選器狀態，避免 regionCenters 異步載入時觸發無效地圖重置
  const prevFilterRef = useRef(selectedFilter);

  // 同步 ref 狀態以供閉包安全讀取
  useEffect(() => {
    showIndustrialZonesRef.current = showIndustrialZones;
  }, [showIndustrialZones]);

  const token = (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '');

  // 1. 初始化地圖
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!token) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: `mapbox://styles/mapbox/${mapStyle}`,
      center: [120.64, 24.16], // 預設以台中市中心為中心
      zoom: 12.5,
      pitch: 45, // 微立體視角
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    map.on('rotate', () => {
      setBearing(map.getBearing());
    });

    const setupIndustrialZones = () => {
      const latestShow = showIndustrialZonesRef.current;
      if (!map.getSource('industrial-zones-source')) {
        console.log('Adding industrial-zones-source...');
        try {
          map.addSource('industrial-zones-source', {
            type: 'geojson',
            data: '/industrial-zones.geojson'
          });
          console.log('industrial-zones-source added successfully.');

          map.addLayer({
            id: 'industrial-zones-fill',
            type: 'fill',
            source: 'industrial-zones-source',
            paint: {
              'fill-color': '#a855f7', // 半透明紫色填充
              'fill-opacity': 0.15
            },
            layout: {
              visibility: latestShow ? 'visible' : 'none'
            }
          });
          console.log('industrial-zones-fill layer added successfully.');

          map.addLayer({
            id: 'industrial-zones-line',
            type: 'line',
            source: 'industrial-zones-source',
            paint: {
              'line-color': '#c084fc', // 紫色虛線邊框
              'line-width': 1.5,
              'line-dasharray': [2, 2]
            },
            layout: {
              visibility: latestShow ? 'visible' : 'none'
            }
          });
          console.log('industrial-zones-line layer added successfully.');

          // 園區點擊彈出 InfoWindow
          map.on('click', 'industrial-zones-fill', (e) => {
            (e as any)._layerClicked = true;
            if (!e.features || e.features.length === 0) return;
            const props = e.features[0].properties;
            if (!props) return;

            const name = props.name || '未知園區';

            new mapboxgl.Popup({ className: 'dark-popup' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div class="font-sans min-w-[160px]">
                  <div class="font-bold text-white border-b border-slate-700/60 pb-1.5 mb-2 text-xs flex items-center gap-1">
                    <span>🏭</span>
                    <span>產業園區基本資訊</span>
                  </div>
                  <div class="grid grid-cols-[70px_1fr] gap-1.5 text-[11px] items-center">
                    <span class="text-slate-500 font-semibold">園區名稱:</span>
                    <span class="font-bold text-slate-200">${name}</span>
                  </div>
                </div>
              `)
              .addTo(map);
          });

          // 滑鼠懸停指針變更
          map.on('mouseenter', 'industrial-zones-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'industrial-zones-fill', () => {
            map.getCanvas().style.cursor = '';
          });

        } catch (error) {
          console.error('Error while adding industrial-zones layers:', error);
        }
      } else {
        console.log('industrial-zones-source already exists, skipping.');
      }
    };

    map.on('load', () => {
      mapRef.current = map;
      (window as any).mapboxMap = map;
      setIsLoaded(true);
      console.log('Mapbox load event triggered.');
      setupIndustrialZones();

      // 初始化全域唯一的 Popup 實例
      globalPopupRef.current = new mapboxgl.Popup({
        offset: 15,
        className: 'dark-popup',
        closeButton: true,
        closeOnClick: false
      });

      globalPopupRef.current.on('close', () => {
        if (isInternalClosingRef.current) return;
        onSelectSensor('');
      });
      
      // 註冊地圖點擊事件，方便使用者框選位置新增事件
      map.on('click', (e) => {
        if ((e as any)._layerClicked) return;
        const target = e.originalEvent.target as HTMLElement;
        if (target && !target.closest('.mapboxgl-marker')) {
          onMapClickCoords?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        }
      });
    });

    map.on('style.load', () => {
      console.log('Mapbox style.load event triggered.');
      setStyleVersion((v) => v + 1);
      setupIndustrialZones();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // 2. 切換地圖風格
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    if (prevStyleRef.current === mapStyle) return;

    console.log(`Switching map style from ${prevStyleRef.current} to ${mapStyle}`);
    mapRef.current.setStyle(`mapbox://styles/mapbox/${mapStyle}`);
    prevStyleRef.current = mapStyle;
  }, [mapStyle, isLoaded]);

  // 2.5 同步控制產業園區圖層可見度
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const visibility = showIndustrialZones ? 'visible' : 'none';
    if (mapRef.current.getLayer('industrial-zones-fill')) {
      mapRef.current.setLayoutProperty('industrial-zones-fill', 'visibility', visibility);
    }
    if (mapRef.current.getLayer('industrial-zones-line')) {
      mapRef.current.setLayoutProperty('industrial-zones-line', 'visibility', visibility);
    }
  }, [showIndustrialZones, isLoaded]);

  // 3. 更新 Marker 點位與顏色 (Surgical Diff 更新，保留 Marker 實例以維持 Popup 狀態)
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    if (!showSensors) {
      // 隱藏時，清除所有 Markers
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      return;
    }

    const currentPointIds = new Set(points.map((p) => p.id));

    // 1. 移除地圖上已不存在於 points 中的舊 Markers
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentPointIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // 2. 更新或新增 Markers
    points.forEach((point) => {
      // 根據當前展示測項設定數值與顏色分級
      const val = point[selectedMetric];
      let bgColor = 'bg-slate-500'; // 預設灰色（無資料）
      let glowColor = 'rgba(100, 116, 139, 0.5)'; // 預設灰色發光

      if (val !== null && val !== undefined) {
        if (selectedMetric === 'pm2_5') {
          if (val < 15.5) { bgColor = 'bg-emerald-500'; glowColor = 'rgba(16, 185, 129, 0.7)'; }
          else if (val <= 35.4) { bgColor = 'bg-yellow-500'; glowColor = 'rgba(234, 179, 8, 0.7)'; }
          else if (val <= 54.4) { bgColor = 'bg-orange-500'; glowColor = 'rgba(249, 115, 22, 0.7)'; }
          else if (val <= 150.4) { bgColor = 'bg-red-500'; glowColor = 'rgba(239, 68, 68, 0.7)'; }
          else if (val <= 250.4) { bgColor = 'bg-purple-500'; glowColor = 'rgba(168, 85, 247, 0.7)'; }
          else { bgColor = 'bg-[#3f000f]'; glowColor = 'rgba(63, 0, 15, 0.75)'; }
        } else if (selectedMetric === 'temperature') {
          if (val < 20.0) { bgColor = 'bg-blue-500'; glowColor = 'rgba(59, 130, 246, 0.7)'; }
          else if (val <= 28.0) { bgColor = 'bg-emerald-500'; glowColor = 'rgba(16, 185, 129, 0.7)'; }
          else if (val <= 35.0) { bgColor = 'bg-yellow-500'; glowColor = 'rgba(234, 179, 8, 0.7)'; }
          else { bgColor = 'bg-red-500'; glowColor = 'rgba(239, 68, 68, 0.7)'; }
        } else if (selectedMetric === 'humidity') {
          if (val < 40) { bgColor = 'bg-orange-500'; glowColor = 'rgba(249, 115, 22, 0.7)'; }
          else if (val <= 70) { bgColor = 'bg-emerald-500'; glowColor = 'rgba(16, 185, 129, 0.7)'; }
          else { bgColor = 'bg-blue-500'; glowColor = 'rgba(59, 130, 246, 0.7)'; }
        }
      }

      const isFire = point.anomalyType === '疑似露天燃燒';
      const isFactory = point.anomalyType === '疑似工廠排污';

      // 格式化資料時間為易讀格式
      let timeStr = 'N/A';
      if (point.time) {
        try {
          const d = new Date(point.time);
          if (!isNaN(d.getTime())) {
            const pad = (n: number) => String(n).padStart(2, '0');
            timeStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          } else {
            timeStr = point.time;
          }
        } catch {
          timeStr = point.time;
        }
      }

      const isPm25Anomaly = selectedMetric === 'pm2_5' && val !== null && val !== undefined && val >= (pm25Threshold ?? 54);
      const isAnomalyPoint = point.isAnomaly || isPm25Anomaly;

      const dotSizeClass = isAnomalyPoint ? 'w-[8px] h-[8px] z-30' : 'w-[5px] h-[5px]';
      const dotGlowClass = isAnomalyPoint ? 'glow-anomaly-sensor' : 'glow-sensor';

      const existingMarker = markersRef.current[point.id];

      if (existingMarker) {
        // 更新現有 Marker
        const wrapper = existingMarker.getElement();
        const el = wrapper.querySelector('.sensor-dot') as HTMLDivElement;
        if (el) {
          let baseClass = `sensor-dot rounded-full cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-125 hover:z-50 ${dotSizeClass} ${dotGlowClass} ${bgColor}`;
          
          // 如果為選中狀態，保留白色描邊樣式
          if (point.id === selectedSensorId) {
            baseClass += ' border border-white scale-125 z-40';
          }

          if (isFire) {
            baseClass += ' ring-4 ring-orange-500/30';
          } else if (isFactory) {
            baseClass += ' ring-4 ring-purple-500/30';
          }
          el.innerHTML = ''; // 5px / 8px 太小，不塞 Emoji，由閃爍與外環代表狀態
          el.className = baseClass;
          el.style.setProperty('--glow-color', glowColor);
        }

        // 更新雷達環 (radar-ping)
        const oldPing = wrapper.querySelector('.radar-ping');
        if (oldPing) oldPing.remove();

        if (isFire) {
          const ping = document.createElement('div');
          ping.className = 'radar-ping';
          ping.style.cssText = 'position:absolute;width:5px;height:5px;border-radius:50%;background:rgba(249,115,22,0.35);pointer-events:none;';
          wrapper.insertBefore(ping, el);
        } else if (isFactory) {
          const ping = document.createElement('div');
          ping.className = 'radar-ping';
          ping.style.cssText = 'position:absolute;width:5px;height:5px;border-radius:50%;background:rgba(168,85,247,0.35);pointer-events:none;';
          wrapper.insertBefore(ping, el);
        } else if (isAnomalyPoint) {
          const ping = document.createElement('div');
          ping.className = 'radar-ping';
          // 超標雷達環使用更亮眼的紅色，且適應 8px 大小
          ping.style.cssText = 'position:absolute;width:8px;height:8px;border-radius:50%;background:rgba(239,68,68,0.4);pointer-events:none;';
          wrapper.insertBefore(ping, el);
        }
      } else {
        // 建立新 Marker 外層容器
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;';

        // 建立自訂 DOM 元素作為 Marker (超標放大至 8px，無描邊，加螢光閃爍)
        const el = document.createElement('div');
        let baseClass = `sensor-dot rounded-full cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-125 hover:z-50 ${dotSizeClass} ${dotGlowClass} ${bgColor}`;
        
        if (point.id === selectedSensorId) {
          baseClass += ' border border-white scale-125 z-40';
        }
        el.className = baseClass;
        el.style.cssText = 'position:relative;z-index:1;';
        el.style.setProperty('--glow-color', glowColor);

        if (isFire) {
          el.className += ` ring-4 ring-orange-500/30`;
          const ping = document.createElement('div');
          ping.className = 'radar-ping';
          ping.style.cssText = 'position:absolute;width:5px;height:5px;border-radius:50%;background:rgba(249,115,22,0.35);pointer-events:none;';
          wrapper.appendChild(ping);
        } else if (isFactory) {
          el.className += ` ring-4 ring-purple-500/30`;
          const ping = document.createElement('div');
          ping.className = 'radar-ping';
          ping.style.cssText = 'position:absolute;width:5px;height:5px;border-radius:50%;background:rgba(168,85,247,0.35);pointer-events:none;';
          wrapper.appendChild(ping);
        } else if (isAnomalyPoint) {
          const ping = document.createElement('div');
          ping.className = 'radar-ping';
          ping.style.cssText = 'position:absolute;width:8px;height:8px;border-radius:50%;background:rgba(239,68,68,0.4);pointer-events:none;';
          wrapper.appendChild(ping);
        }

        // 當點選時通知父元件
        el.addEventListener('click', () => {
          onSelectSensor(point.id);
        });

        wrapper.appendChild(el);

        const marker = new mapboxgl.Marker(wrapper)
          .setLngLat([point.lon, point.lat])
          .addTo(mapRef.current!);

        markersRef.current[point.id] = marker;
      }
    });
  }, [points, isLoaded, selectedMetric, showSensors, selectedSensorId, pm25Threshold]);

  // 3.1 同步更新 Selected Sensor 的樣式與全域唯一 Popup 顯示狀態
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;

    // 清除所有 Marker 的選中效果
    Object.keys(markersRef.current).forEach((id) => {
      const marker = markersRef.current[id];
      if (marker) {
        const wrapper = marker.getElement();
        const dot = wrapper.querySelector('.sensor-dot');
        if (dot) {
          dot.classList.remove('border', 'border-white', 'scale-125', 'z-40');
        }
      }
    });

    // 幫選中的 Marker 加上樣式並開啟全域唯一 Popup
    if (selectedSensorId) {
      const marker = markersRef.current[selectedSensorId];
      const point = points.find((p) => p.id === selectedSensorId);
      
      if (marker && point) {
        const wrapper = marker.getElement();
        const dot = wrapper.querySelector('.sensor-dot');
        if (dot) {
          dot.classList.add('border', 'border-white', 'scale-125', 'z-40');
        }

        // 初始化全域唯一的 Popup 實例
        if (!globalPopupRef.current) {
          globalPopupRef.current = new mapboxgl.Popup({
            offset: 15,
            className: 'dark-popup',
            closeButton: true,
            closeOnClick: false
          });

          // 綁定關閉事件，清除選中狀態
          globalPopupRef.current.on('close', () => {
            if (isInternalClosingRef.current) return;
            onSelectSensor('');
          });
        }

        // 動態判定數值分級顏色
        let pm25Color = '#10b981';
        if (point.pm2_5 !== null && point.pm2_5 !== undefined) {
          const p = point.pm2_5;
          if (p < 15.5) pm25Color = '#10b981'; // 良好
          else if (p <= 35.4) pm25Color = '#eab308'; // 普通 (黃)
          else if (p <= 54.4) pm25Color = '#f97316'; // 敏感橘
          else if (p <= 150.4) pm25Color = '#ef4444'; // 不健康 (紅)
          else if (p <= 250.4) pm25Color = '#a855f7'; // 非常不健康
          else pm25Color = '#881337'; // 危害
        } else {
          pm25Color = '#64748b';
        }

        let tempColor = '#3b82f6';
        if (point.temperature !== null && point.temperature !== undefined) {
          const t = point.temperature;
          if (t < 20.0) tempColor = '#3b82f6';
          else if (t <= 28.0) tempColor = '#10b981';
          else if (t <= 35.0) tempColor = '#eab308';
          else tempColor = '#ef4444';
        } else {
          tempColor = '#64748b';
        }

        let humColor = '#10b981';
        if (point.humidity !== null && point.humidity !== undefined) {
          const h = point.humidity;
          if (h < 40) humColor = '#f97316';
          else if (h <= 70) humColor = '#10b981';
          else humColor = '#3b82f6';
        } else {
          humColor = '#64748b';
        }

        let timeStr = 'N/A';
        if (point.time) {
          try {
            const d = new Date(point.time);
            if (!isNaN(d.getTime())) {
              const pad = (n: number) => String(n).padStart(2, '0');
              timeStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            } else {
              timeStr = point.time;
            }
          } catch {
            timeStr = point.time;
          }
        }

        const pm25Str = point.pm2_5 !== null && point.pm2_5 !== undefined ? `${point.pm2_5} ug/m³` : 'N/A';
        const tempStr = point.temperature !== null && point.temperature !== undefined ? `${point.temperature} °C` : 'N/A';
        const humStr = point.humidity !== null && point.humidity !== undefined ? `${point.humidity} %` : 'N/A';

        const popupHtml = `
          <div class="font-sans min-w-[200px]">
            <div style="display:grid;grid-template-columns:70px 1fr;gap:6px 8px;font-size:11px;align-items:center;">
              <span style="color:#64748b;font-weight:600;">Device ID:</span>
              <span style="font-weight:700;color:#fff;">${point.id}</span>
              
              <span style="color:#64748b;font-weight:600;">經緯度:</span>
              <span style="font-weight:700;color:#e2e8f0;">${point.lon.toFixed(5)}, ${point.lat.toFixed(5)}</span>
              
              <span style="color:#64748b;font-weight:600;">資料時間:</span>
              <span style="font-weight:700;color:#e2e8f0;">${timeStr}</span>
              
              <span style="color:#64748b;font-weight:600;">PM₂.₅:</span>
              <span style="font-weight:700;color:${pm25Color};font-size:12px;">${pm25Str}</span>
              
              <span style="color:#64748b;font-weight:600;">溫度:</span>
              <span style="font-weight:700;color:${tempColor};">${tempStr}</span>
              
              <span style="color:#64748b;font-weight:600;">濕度:</span>
              <span style="font-weight:700;color:${humColor};">${humStr}</span>
            </div>
            \${point.anomalyType ? \`<p style="margin-top:8px;font-size:11px;font-weight:700;color:#f87171;background:rgba(239,68,68,0.1);padding:3px 8px;border-radius:6px;text-align:center;border:1px solid rgba(239,68,68,0.2);">🚨 警告：\${point.anomalyType}</p>\` : ''}
          </div>
        `;

        globalPopupRef.current
          .setLngLat([point.lon, point.lat])
          .setHTML(popupHtml)
          .addTo(mapRef.current);
      }
    } else {
      if (globalPopupRef.current && globalPopupRef.current.isOpen()) {
        isInternalClosingRef.current = true;
        globalPopupRef.current.remove();
        isInternalClosingRef.current = false;
      }
    }
  }, [selectedSensorId, points, isLoaded, selectedMetric]);

  // 3.2 監聽 selectedSensorId 變更，地圖平滑飛越與縮放至該設備
  useEffect(() => {
    if (!mapRef.current || !isLoaded || !selectedSensorId) return;

    // 互斥鎖：若 activeEvent 存在且選中的 sensor 屬於該事件的感測器之一，
    // 則優先讓 activeEvent 的 flyTo 處理，避免兩個 flyTo 爭奪相機控制權
    if (activeEvent && (activeEvent as any).sensors?.some((s: any) => s.id === selectedSensorId)) return;

    const marker = markersRef.current[selectedSensorId];
    if (marker) {
      const lngLat = marker.getLngLat();
      console.log(`Zooming in to selected sensor ${selectedSensorId} at [${lngLat.lng}, ${lngLat.lat}]`);
      mapRef.current.flyTo({
        center: [lngLat.lng, lngLat.lat],
        zoom: 14.5,
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
    }
  }, [selectedSensorId, isLoaded, activeEvent]);

  // 3.5 更新核密度圖 (Heatmap Layer)
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    // 建立 GeoJSON FeatureCollection
    const features: any = points
      .filter((pt) => {
        const val = pt[selectedMetric];
        return val !== null && val !== undefined && !isNaN(val);
      })
      .map((pt) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [pt.lon, pt.lat]
        },
        properties: {
          id: pt.id,
          value: pt[selectedMetric]
        }
      }));

    // 根據 selectedMetric 動態調整權重插值範圍
    let maxVal = 100;
    if (selectedMetric === 'pm2_5') maxVal = 250.5;
    else if (selectedMetric === 'temperature') maxVal = 40;
    else if (selectedMetric === 'humidity') maxVal = 100;

    const heatmapWeight = [
      'interpolate',
      ['linear'],
      ['get', 'value'],
      0, 0,
      maxVal, 1
    ] as any;

    const heatmapColor = (selectedMetric === 'temperature'
      ? [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, '#3b82f6', // 涼爽
          0.4, '#60a5fa',
          0.6, '#10b981',
          0.8, '#f59e0b',
          1.0, '#ef4444'  // 炎熱
        ]
      : selectedMetric === 'humidity'
      ? [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.3, '#f97316', // 乾燥
          0.6, '#10b981', // 舒適
          1.0, '#3b82f6'  // 潮濕
        ]
      : [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.15, '#10b981', // 良好 (綠)
          0.3, '#eab308',  // 普通 (黃)
          0.45, '#f97316', // 敏感橘 (橘)
          0.6, '#ef4444',  // 不健康 (紅)
          0.8, '#a855f7',  // 非常不健康 (紫)
          1.0, '#3f000f'   // 危害 (危害深褐色/黑紅)
        ]) as any;

    const sourceId = 'sensors-heatmap-source';
    const layerId = 'sensors-heatmap-layer';

    const existingSource: any = map.getSource(sourceId);

    if (existingSource) {
      // 1. 若已存在，直接更新數據與屬性
      existingSource.setData({
        type: 'FeatureCollection',
        features: features
      });

      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'heatmap-weight', heatmapWeight);
        map.setPaintProperty(layerId, 'heatmap-color', heatmapColor);
        map.setLayoutProperty(layerId, 'visibility', showHeatmap && features.length > 0 ? 'visible' : 'none');
      }
    } else {
      // 2. 若不存在，且需要顯示時才建立
      if (!showHeatmap || features.length === 0) return;

      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });

      map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: sourceId,
        maxzoom: 15,
        paint: {
          'heatmap-weight': heatmapWeight,
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            15, 3
          ],
          'heatmap-color': heatmapColor,
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 15,
            15, 45
          ],
          'heatmap-opacity': 0.55
        }
      }, map.getLayer('industrial-zones-fill') ? 'industrial-zones-fill' : undefined);
    }
  }, [points, selectedMetric, isLoaded, styleVersion, showHeatmap]);

  // 4. 更新聚類熱區 Layer
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    const map = mapRef.current;

    // 建立 GeoJSON FeatureCollection 畫出所有聚類熱區圓形
    const features: any = clusters.map((cluster) => {
      // 藉由畫出 Polygon 圓圈模擬 cluster 半徑
      const center = [cluster.center.lon, cluster.center.lat];
      const radius = cluster.radiusKm;
      const pointsCount = 64;
      const coords: number[][] = [];
      
      for (let i = 0; i < pointsCount; i++) {
        const angle = (i / pointsCount) * 360;
        const radian = (angle * Math.PI) / 180;
        const dx = radius * Math.cos(radian);
        const dy = radius * Math.sin(radian);
        
        // 粗略經緯度轉換 (1度緯度約 111公里, 經度約 111 * cos(lat)公里)
        const latOffset = dy / 111;
        const lonOffset = dx / (111 * Math.cos((center[1] * Math.PI) / 180));
        coords.push([center[0] + lonOffset, center[1] + latOffset]);
      }
      coords.push(coords[0]); // 閉合 polygon

      return {
        type: 'Feature',
        properties: {
          id: cluster.id,
          stationsCount: cluster.stationsCount,
          avgPm25: cluster.avgPm25,
          dominantType: cluster.dominantType,
          radiusKm: cluster.radiusKm
        },
        geometry: {
          type: 'Polygon',
          coordinates: [coords]
        }
      };
    });

    const sourceId = 'clusters-source';
    const fillLayerId = 'clusters-fill-layer';
    const outlineLayerId = 'clusters-outline-layer';

    const existingSource: any = map.getSource(sourceId);

    if (existingSource) {
      // 1. 若 Source 已存在，直接更新數據
      existingSource.setData({
        type: 'FeatureCollection',
        features: features
      });
    } else {
      // 2. 若不存在，進行初始化建立
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });

      // 填充圓圈顏色 (紅色半透明)
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#ef4444',
          'fill-opacity': 0.15
        }
      });

      // 圓圈描邊
      map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ef4444',
          'line-width': 2,
          'line-dasharray': [2, 2]
        }
      });

      // 熱區滑鼠懸停與點擊事件 (只需註冊一次)
      map.on('click', fillLayerId, (e) => {
        (e as any)._layerClicked = true;
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        if (!props) return;
        
        new mapboxgl.Popup({ className: 'dark-popup' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div class="font-sans min-w-[180px]">
              <div class="font-bold text-red-400 border-b border-red-500/20 pb-1.5 mb-2 text-xs flex items-center gap-1">
                <span>🚨</span>
                <span>異常聚集熱區</span>
              </div>
              <div class="grid grid-cols-[80px_1fr] gap-1.5 text-[11px] items-center">
                <span class="text-slate-500 font-semibold">測站總數:</span>
                <span class="font-bold text-slate-200">${props.stationsCount} 站</span>
                
                <span class="text-slate-500 font-semibold">平均 PM₂.₅:</span>
                <span class="font-bold text-red-400">${parseFloat(props.avgPm25).toFixed(1)} µg/m³</span>
                
                <span class="text-slate-500 font-semibold">主導類型:</span>
                <span class="font-bold text-slate-200">${props.dominantType && props.dominantType !== '--' && props.dominantType !== 'undefined' ? props.dominantType : '微感超標-群聚'}</span>
                
                <span class="text-slate-500 font-semibold">涵蓋半徑:</span>
                <span class="font-bold text-slate-400">${props.radiusKm} km</span>
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', fillLayerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', fillLayerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }
  }, [clusters, isLoaded, styleVersion]);

  // 4.5 更新當前選定事件 (activeEvent) 的警示範圍 Layer
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    const map = mapRef.current;
    const sourceId = 'active-event-source';
    const fillLayerId = 'active-event-fill-layer';
    const outlineLayerId = 'active-event-outline-layer';

    // 如果沒有選中事件，清空數據
    if (!activeEvent || !activeEvent.bounds?.center) {
      const existingSource: any = map.getSource(sourceId);
      if (existingSource) {
        existingSource.setData({
          type: 'FeatureCollection',
          features: []
        });
      }
      return;
    }

    const lat = activeEvent.bounds.center.lat;
    const lng = (activeEvent.bounds.center as any).lng ?? (activeEvent.bounds.center as any).lon;
    const radius = activeEvent.bounds.radiusKm || 1.0;

    if (lat === undefined || lng === undefined) return;

    // 計算 64 個點構成圓形 Polygon
    const center = [lng, lat];
    const pointsCount = 64;
    const coords: number[][] = [];
    
    for (let i = 0; i < pointsCount; i++) {
      const angle = (i / pointsCount) * 360;
      const radian = (angle * Math.PI) / 180;
      const dx = radius * Math.cos(radian);
      const dy = radius * Math.sin(radian);
      
      const latOffset = dy / 111;
      const lonOffset = dx / (111 * Math.cos((center[1] * Math.PI) / 180));
      coords.push([center[0] + lonOffset, center[1] + latOffset]);
    }
    coords.push(coords[0]); // 閉合 polygon

    const geojsonFeature = {
      type: 'Feature',
      properties: {
        id: activeEvent.id,
        radiusKm: radius
      },
      geometry: {
        type: 'Polygon',
        coordinates: [coords]
      }
    };

    const existingSource: any = map.getSource(sourceId);

    if (existingSource) {
      existingSource.setData({
        type: 'FeatureCollection',
        features: [geojsonFeature]
      });
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [geojsonFeature]
        }
      });

      // 橘色半透明填充
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#f97316',
          'fill-opacity': 0.15
        }
      });

      // 橘色虛線描邊
      map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#f97316',
          'line-width': 2.5,
          'line-dasharray': [3, 2]
        }
      });
    }
  }, [activeEvent, isLoaded, styleVersion]);

  // 5. 監聽 selectedClusterId 變更，地圖平滑飛越與縮放
  useEffect(() => {
    if (!mapRef.current || !isLoaded || !selectedClusterId) return;

    const cluster = clusters.find((c) => c.id === selectedClusterId);
    if (cluster) {
      console.log(`Zooming in to cluster ${selectedClusterId} at [${cluster.center.lon}, ${cluster.center.lat}]`);
      mapRef.current.flyTo({
        center: [cluster.center.lon, cluster.center.lat],
        zoom: 14.5,
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
    }
  }, [selectedClusterId, clusters, isLoaded]);

  // 5.2 監聽 activeEvent 變更，地圖平滑飛越與縮放至事件中心
  useEffect(() => {
    if (!mapRef.current || !isLoaded || !activeEvent || !activeEvent.bounds?.center) return;

    const lat = activeEvent.bounds.center.lat;
    const lng = (activeEvent.bounds.center as any).lng ?? (activeEvent.bounds.center as any).lon;

    if (lat !== undefined && lng !== undefined) {
      console.log(`Zooming in to active event center at [${lng}, ${lat}]`);
      mapRef.current.flyTo({
        center: [lng, lat],
        zoom: 14.5,
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
    }
  }, [activeEvent, isLoaded]);

  // 5.5 監聽第一層篩選變更，地圖平滑飛越與縮放至區域中心
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    // 核心修復：只有在篩選器真正改變時才執行 flyTo，
    // 避免 regionCenters 非同步載入完成時觸發無效的地圖相機重置
    const hasFilterChanged =
      prevFilterRef.current.type !== selectedFilter.type ||
      prevFilterRef.current.value !== selectedFilter.value;
    prevFilterRef.current = selectedFilter;
    if (!hasFilterChanged) return;

    if (selectedFilter.type === 'all') {
      console.log('Resetting map camera to Taichung city center.');
      mapRef.current.flyTo({
        center: [120.64, 24.16],
        zoom: 12.5,
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
      return;
    }

    const key = `${selectedFilter.type}_${selectedFilter.value}`;
    const center = regionCenters[key];
    if (center) {
      console.log(`Zooming in to region ${key} at [${center[0]}, ${center[1]}]`);
      mapRef.current.flyTo({
        center: center,
        zoom: selectedFilter.type === 'zone' ? 14.2 : 13.2,
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
    }
  }, [selectedFilter, regionCenters, isLoaded]);

  const renderScaleBar = () => {
    let gradientStyle = '';
    let unit = '';
    let title = '';
    let steps: { value: number; label: string }[] = [];

    // 計算當前測值實際最大值與最小值
    const validVals = points
      .map(pt => pt[selectedMetric])
      .filter(val => val !== null && val !== undefined && !isNaN(val)) as number[];
    const actualMin = validVals.length > 0 ? Math.min(...validVals) : 0;
    const actualMax = validVals.length > 0 ? Math.max(...validVals) : 0;

    if (selectedMetric === 'pm2_5') {
      title = 'PM₂.₅ 熱區密度';
      gradientStyle = 'linear-gradient(to right, #10b981, #eab308, #f97316, #ef4444, #a855f7, #3f000f)';
      unit = 'µg/m³';
      steps = [
        { value: 15.4, label: '15.4' },
        { value: 35.4, label: '35.4' },
        { value: 54.4, label: '54.4' },
        { value: 150.4, label: '150.4' },
        { value: 250.4, label: '250.4' },
        { value: 250.5, label: '250.5+' }
      ];
    } else if (selectedMetric === 'temperature') {
      title = '溫度熱區密度';
      gradientStyle = 'linear-gradient(to right, #3b82f6, #10b981, #f59e0b, #ef4444)';
      unit = '°C';
      steps = [
        { value: 0, label: '0' },
        { value: 8, label: '8' },
        { value: 20, label: '20' },
        { value: 32, label: '32' },
        { value: 40, label: '40+' }
      ];
    } else if (selectedMetric === 'humidity') {
      title = '濕度熱區密度';
      gradientStyle = 'linear-gradient(to right, #f97316, #10b981, #3b82f6)';
      unit = '%';
      steps = [
        { value: 0, label: '0' },
        { value: 30, label: '30' },
        { value: 60, label: '60' },
        { value: 100, label: '100' }
      ];
    }

    const actualMinStr = validVals.length > 0 ? `${actualMin.toFixed(1)} ${unit}` : 'N/A';
    const actualMaxStr = validVals.length > 0 ? `${actualMax.toFixed(1)} ${unit}` : 'N/A';

    return (
      <div className="absolute bottom-4 right-4 glass-card rounded-xl p-3 z-10 shadow-lg text-xs flex flex-col gap-2 min-w-[240px] max-w-[280px] border border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-0.5">
          <h5 className="font-bold text-slate-200">{title}</h5>
          <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded-full font-semibold">
            {unit}
          </span>
        </div>
        
        {/* 顏色漸層條 */}
        <div className="relative my-0.5">
          <div 
            className="w-full h-3 rounded-full shadow-inner border border-slate-800/80" 
            style={{ background: gradientStyle }}
          />
        </div>

        {/* 顏色對應的測值切點 */}
        <div className="flex justify-between text-[9px] text-slate-400 font-bold px-0.5 mb-0.5">
          {steps.map((step, idx) => (
            <span key={idx}>{step.label}</span>
          ))}
        </div>

        {/* 當前實測最大/最小值展示 */}
        <div className="bg-slate-900/60 rounded-lg p-2 flex flex-col gap-1 border border-slate-800/50">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">當前實測最小值:</span>
            <span className="font-bold text-emerald-400">{actualMinStr}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">當前實測最大值:</span>
            <span className="font-bold text-red-400">{actualMaxStr}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* 地圖容器 */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* 無 API Key 警告 */}
      {!token && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-50">
          <AlertTriangle className="text-amber-500 w-16 h-16 mb-4 animate-bounce" />
          <h3 className="text-xl font-bold text-white mb-2">未設定 Mapbox API Key</h3>
          <p className="text-slate-400 max-w-md text-sm mb-4">
            請在專案目錄下的 <code className="bg-slate-800 px-2 py-0.5 rounded text-orange-500">.env.local</code> 檔案中，將 Mapbox 的 Token 填入 <code className="bg-slate-800 px-2 py-0.5 rounded text-orange-500">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> 中。
          </p>
        </div>
      )}

      {/* 地圖右上角浮動控制項組 */}
      {token && (
        <div className="absolute top-3 right-3 lg:top-4 lg:right-4 flex flex-col items-end gap-2 z-10">
          
          {/* 第一排：水平排列的獨立控制按鈕 */}
          <div className="flex items-center gap-2">
            
            {/* 1. 底圖切換按鈕 */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowBaseMapMenu(!showBaseMapMenu);
                  setShowLayerMenu(false); // 互斥
                }}
                className={`w-9 h-9 rounded-xl bg-slate-900/95 backdrop-blur-md border flex items-center justify-center text-slate-300 hover:text-orange-500 hover:border-orange-500/50 shadow-lg transition-all duration-300 cursor-pointer ${showBaseMapMenu ? 'border-orange-500 text-orange-500 ring-2 ring-orange-500/20' : 'border-slate-800'}`}
                title="切換地圖底圖"
              >
                <Layers className="w-4.5 h-4.5" />
              </button>
              
              {showBaseMapMenu && (
                <div className="absolute right-0 mt-2 w-28 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-xl p-1.5 shadow-2xl flex flex-col gap-1 z-20 animate-in fade-in slide-in-from-top-2 duration-200">
                  <button
                    onClick={() => { setMapStyle('dark-v11'); setShowBaseMapMenu(false); }}
                    className={`px-2.5 py-1.5 text-left rounded-lg text-[11px] font-medium transition-colors cursor-pointer w-full ${mapStyle === 'dark-v11' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'}`}
                  >
                    深色地圖
                  </button>
                  <button
                    onClick={() => { setMapStyle('satellite-streets-v12'); setShowBaseMapMenu(false); }}
                    className={`px-2.5 py-1.5 text-left rounded-lg text-[11px] font-medium transition-colors cursor-pointer w-full ${mapStyle === 'satellite-streets-v12' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'}`}
                  >
                    衛星街道
                  </button>
                  <button
                    onClick={() => { setMapStyle('streets-v12'); setShowBaseMapMenu(false); }}
                    className={`px-2.5 py-1.5 text-left rounded-lg text-[11px] font-medium transition-colors cursor-pointer w-full ${mapStyle === 'streets-v12' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'}`}
                  >
                    街道地圖
                  </button>
                </div>
              )}
            </div>

            {/* 2. 指北針按鈕 */}
            <button
              onClick={() => {
                if (mapRef.current) {
                  mapRef.current.easeTo({ bearing: 0, pitch: 0, duration: 1000 });
                }
              }}
              className="w-9 h-9 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-800 flex items-center justify-center text-slate-300 hover:text-orange-500 hover:border-orange-500/50 shadow-lg transition-all duration-300 cursor-pointer"
              title="地圖正北轉正"
            >
              <Compass 
                className="w-4.5 h-4.5 transition-transform duration-200" 
                style={{ transform: `rotate(${-bearing}deg)` }} 
              />
            </button>

            {/* 3. 地圖圖層折疊主按鈕 */}
            <button
              onClick={() => {
                setShowLayerMenu(!showLayerMenu);
                setShowBaseMapMenu(false); // 互斥
              }}
              className={`h-9 px-3 rounded-xl bg-slate-900/95 backdrop-blur-md border flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-orange-500 hover:border-orange-500/50 shadow-lg transition-all duration-300 cursor-pointer ${showLayerMenu ? 'border-orange-500 text-orange-500 ring-2 ring-orange-500/20' : 'border-slate-800'}`}
            >
              <span className={`transition-transform duration-300 ${showLayerMenu ? 'rotate-180 text-orange-500' : ''}`}>⚙️</span>
              地圖圖層
            </button>

          </div>

          {/* 第二排：當圖層選單展開時的 Checkbox 面板 (垂直收折) */}
          {showLayerMenu && (
            <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl p-3 shadow-2xl flex flex-col gap-2.5 min-w-[140px] animate-in fade-in slide-in-from-top-2 duration-200">
              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={showIndustrialZones}
                  onChange={(e) => setShowIndustrialZones(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                產業園區
              </label>
              
              <div className="h-px bg-slate-800/60 w-full" />
              
              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={showSensors}
                  onChange={(e) => setShowSensors(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                空品微感
              </label>
              
              <div className="h-px bg-slate-800/60 w-full" />
              
              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                微感熱區
              </label>
            </div>
          )}

        </div>
      )}

      {renderScaleBar()}
    </div>
  );
};

export default SensorMap;
