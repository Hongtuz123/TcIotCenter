'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Sensor, Cluster, Observation } from '@/types';
import { Layers, Flame, AlertTriangle, ShieldCheck } from 'lucide-react';

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
  selectedMetric
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});
  const [mapStyle, setMapStyle] = useState<'dark-v11' | 'satellite-streets-v12' | 'streets-v12'>('dark-v11');
  const [isLoaded, setIsLoaded] = useState(false);
  const [showIndustrialZones, setShowIndustrialZones] = useState(true);
  const [styleVersion, setStyleVersion] = useState(0);
  const showIndustrialZonesRef = useRef(showIndustrialZones);
  const prevStyleRef = useRef(mapStyle);

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
      
      // 註冊地圖點擊事件，方便使用者框選位置新增事件
      map.on('click', (e) => {
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

  // 3. 更新 Marker 點位與顏色
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    // 清除舊的 Markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    points.forEach((point) => {
      // 建立 Marker 外層容器（支援雷達脇衝環效果）
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;';

      // 建立自訂 DOM 元素作為 Marker
      const el = document.createElement('div');
      el.className = `w-6 h-6 rounded-full border-2 border-slate-900 cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-125 hover:z-50`;
      el.style.cssText = 'position:relative;z-index:1;';

      // 根據當前展示測項設定數值與顏色分級
      const val = point[selectedMetric];
      let bgColor = 'bg-slate-500'; // 預設灰色（無資料）

      if (val !== null && val !== undefined) {
        if (selectedMetric === 'pm2_5') {
          if (val < 15.5) bgColor = 'bg-emerald-500'; // 良好
          else if (val <= 35.4) bgColor = 'bg-yellow-500'; // 普通
          else if (val <= 54.4) bgColor = 'bg-orange-500'; // 敏感不健康
          else bgColor = 'bg-red-500'; // 不健康
        } else if (selectedMetric === 'temperature') {
          if (val < 20.0) bgColor = 'bg-blue-500'; // 涼爽
          else if (val <= 28.0) bgColor = 'bg-emerald-500'; // 舒適
          else if (val <= 35.0) bgColor = 'bg-yellow-500'; // 偏熱
          else bgColor = 'bg-red-500'; // 炎熱
        } else if (selectedMetric === 'humidity') {
          if (val < 40) bgColor = 'bg-orange-500'; // 乾燥
          else if (val <= 70) bgColor = 'bg-emerald-500'; // 舒適
          else bgColor = 'bg-blue-500'; // 潮濕
        }
      }

      const isFire = point.anomalyType === '疑似露天燃燒';
      const isFactory = point.anomalyType === '疑似工廠排污';

      if (isFire) {
        el.className += ` ${bgColor} border-red-300 ring-4 ring-orange-500/30`;
        el.innerHTML = '🔥';
        // 雷達脇衝環
        const ping = document.createElement('div');
        ping.className = 'radar-ping';
        ping.style.cssText = 'position:absolute;width:24px;height:24px;border-radius:50%;background:rgba(249,115,22,0.35);pointer-events:none;';
        wrapper.appendChild(ping);
      } else if (isFactory) {
        el.className += ` ${bgColor} border-purple-300 ring-4 ring-purple-500/30`;
        el.innerHTML = '🏭';
        const ping = document.createElement('div');
        ping.className = 'radar-ping';
        ping.style.cssText = 'position:absolute;width:24px;height:24px;border-radius:50%;background:rgba(168,85,247,0.35);pointer-events:none;';
        wrapper.appendChild(ping);
      } else if (selectedMetric === 'pm2_5' && val !== null && val !== undefined && val > 54) {
        el.className += ` ${bgColor}`;
        const ping = document.createElement('div');
        ping.className = 'radar-ping';
        ping.style.cssText = 'position:absolute;width:24px;height:24px;border-radius:50%;background:rgba(239,68,68,0.3);pointer-events:none;';
        wrapper.appendChild(ping);
      } else {
        el.className += ` ${bgColor}`;
      }

      if (!isFire && !isFactory && point.id === selectedSensorId) {
        el.className += ' ring-4 ring-white scale-125 z-40';
      }

      el.addEventListener('click', () => {
        onSelectSensor(point.id);
      });

      // 設定當前測項名稱與測值字串
      let metricName = '';
      let metricValStr = '';
      if (selectedMetric === 'pm2_5') {
        metricName = 'PM₂.₅';
        metricValStr = val !== null && val !== undefined ? `${val} ug/m³` : 'N/A';
      } else if (selectedMetric === 'temperature') {
        metricName = '溫度';
        metricValStr = val !== null && val !== undefined ? `${val} °C` : 'N/A';
      } else if (selectedMetric === 'humidity') {
        metricName = '濕度';
        metricValStr = val !== null && val !== undefined ? `${val} %` : 'N/A';
      }

      // 深色玻璃風格彈出氣泡窗，只呈現 deviceID、經緯度、測項、測值
      const popup = new mapboxgl.Popup({ offset: 15, className: 'dark-popup' }).setHTML(`
        <div style="padding:10px;font-family:Inter,sans-serif;color:#f1f5f9;background:rgba(8,14,26,0.97);border-radius:10px;min-width:180px;border:1px solid rgba(249,115,22,0.35);">
          <div style="display:grid;grid-template-columns:70px 1fr;gap:6px 8px;font-size:11px;align-items:center;">
            <span style="color:#64748b;font-weight:600;">Device ID:</span>
            <span style="font-weight:700;color:#fff;">${point.id}</span>
            
            <span style="color:#64748b;font-weight:600;">經緯度:</span>
            <span style="font-weight:700;color:#e2e8f0;">${point.lon.toFixed(5)}, ${point.lat.toFixed(5)}</span>
            
            <span style="color:#64748b;font-weight:600;">測項:</span>
            <span style="font-weight:700;color:#e2e8f0;">${metricName}</span>
            
            <span style="color:#64748b;font-weight:600;">測值:</span>
            <span style="font-weight:700;color:#f97316;font-size:12px;">${metricValStr}</span>
          </div>
          ${point.anomalyType ? `<p style="margin-top:8px;font-size:11px;font-weight:700;color:#f87171;background:rgba(239,68,68,0.1);padding:3px 8px;border-radius:6px;text-align:center;border:1px solid rgba(239,68,68,0.2);">🚨 警告：${point.anomalyType}</p>` : ''}
        </div>
      `);

      // 建立 Marker 並加入地圖
      const marker = new mapboxgl.Marker(wrapper)
        .setLngLat([point.lon, point.lat])
        .setPopup(popup)
        .addTo(mapRef.current!);

      markersRef.current[point.id] = marker;
    });
  }, [points, selectedSensorId, isLoaded, selectedMetric]);

  // 3.5 更新核密度圖 (Heatmap Layer)
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    // 先清除舊的 Layer 和 Source
    if (map.getLayer('sensors-heatmap-layer')) map.removeLayer('sensors-heatmap-layer');
    if (map.getSource('sensors-heatmap-source')) map.removeSource('sensors-heatmap-source');

    // 建立 GeoJSON FeatureCollection
    const features = points
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

    if (features.length === 0) return;

    map.addSource('sensors-heatmap-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features as any
      }
    });

    // 根據 selectedMetric 動態調整權重插值範圍
    let maxVal = 100;
    if (selectedMetric === 'pm2_5') maxVal = 75;
    else if (selectedMetric === 'temperature') maxVal = 40;
    else if (selectedMetric === 'humidity') maxVal = 100;

    map.addLayer({
      id: 'sensors-heatmap-layer',
      type: 'heatmap',
      source: 'sensors-heatmap-source',
      maxzoom: 15,
      paint: {
        'heatmap-weight': [
          'interpolate',
          ['linear'],
          ['get', 'value'],
          0, 0,
          maxVal, 1
        ],
        'heatmap-intensity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 1,
          15, 3
        ],
        'heatmap-color': selectedMetric === 'temperature'
          ? [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(0,0,0,0)',
              0.2, '#3b82f6', // 涼爽
              0.5, '#10b981', // 舒適
              0.8, '#f59e0b', // 偏熱
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
              0.2, '#10b981', // 良好
              0.4, '#eab308', // 普通
              0.6, '#f97316', // 敏感橘
              0.8, '#ef4444', // 不健康
              1.0, '#a855f7'  // 非常不健康
            ],
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

  }, [points, selectedMetric, isLoaded, styleVersion]);

  // 4. 更新聚類熱區 Layer
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    const map = mapRef.current;

    // 若 source 與 layer 存在，先移除
    if (map.getLayer('clusters-fill-layer')) map.removeLayer('clusters-fill-layer');
    if (map.getLayer('clusters-outline-layer')) map.removeLayer('clusters-outline-layer');
    if (map.getSource('clusters-source')) map.removeSource('clusters-source');

    // 建立 GeoJSON FeatureCollection 畫出所有聚類熱區圓形
    const features = clusters.map((cluster) => {
      // 藉由畫出 Polygon 圓圈模擬 cluster 半徑
      const center = [cluster.center.lon, cluster.center.lat];
      const radius = cluster.radiusKm;
      const points = 64;
      const coords: number[][] = [];
      
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * 360;
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

    map.addSource('clusters-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features as any
      }
    });

    // 填充圓圈顏色 (紅色半透明)
    map.addLayer({
      id: 'clusters-fill-layer',
      type: 'fill',
      source: 'clusters-source',
      paint: {
        'fill-color': '#ef4444',
        'fill-opacity': 0.15
      }
    });

    // 圓圈描邊
    map.addLayer({
      id: 'clusters-outline-layer',
      type: 'line',
      source: 'clusters-source',
      paint: {
        'line-color': '#ef4444',
        'line-width': 2,
        'line-dasharray': [2, 2]
      }
    });

    // 熱區滑鼠懸停與點擊事件
    map.on('click', 'clusters-fill-layer', (e) => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      
      new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="p-2 text-slate-900 font-sans">
            <h4 class="font-bold text-red-600 mb-1">🚨 異常聚集熱區</h4>
            <p class="text-xs text-slate-700">測站總數：<strong>${props.stationsCount} 站</strong></p>
            <p class="text-xs text-slate-700">平均 PM2.5：<strong>${parseFloat(props.avgPm25).toFixed(1)} ug/m³</strong></p>
            <p class="text-xs text-slate-700">主導類型：<strong>${props.dominantType}</strong></p>
            <p class="text-[10px] text-slate-400 mt-1">半徑: ${props.radiusKm} km</p>
          </div>
        `)
        .addTo(map);
    });

    map.on('mouseenter', 'clusters-fill-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'clusters-fill-layer', () => {
      map.getCanvas().style.cursor = '';
    });

  }, [clusters, isLoaded, styleVersion]);

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

  // 5.5 監聽第一層篩選變更，地圖平滑飛越與縮放至區域中心
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
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

      {/* 地圖樣式與控制面板 */}
      {token && (
        <div className="absolute top-3 right-3 lg:top-4 lg:right-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg p-1.5 lg:p-2 flex flex-col sm:flex-row items-start sm:items-center gap-2 lg:gap-3 z-10 shadow-lg text-[10px] lg:text-xs">
          <div className="flex items-center gap-1.5 lg:gap-2">
            <Layers className="text-orange-500 w-4 h-4" />
            <select
              value={mapStyle}
              onChange={(e) => setMapStyle(e.target.value as any)}
              className="bg-transparent text-slate-200 border-none outline-none cursor-pointer pr-4 font-medium"
            >
              <option value="dark-v11" className="bg-slate-900">深色地圖</option>
              <option value="satellite-streets-v12" className="bg-slate-900">衛星街道</option>
              <option value="streets-v12" className="bg-slate-900">街道地圖</option>
            </select>
          </div>
          <div className="h-px sm:h-4 w-full sm:w-px bg-slate-800 self-stretch sm:self-center" />
          <label className="flex items-center gap-1.5 text-slate-300 font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showIndustrialZones}
              onChange={(e) => setShowIndustrialZones(e.target.checked)}
              className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
            />
            台中產業園區
          </label>
        </div>
      )}

      {/* 圖例說明 */}
      <div className="hidden sm:flex absolute bottom-4 left-4 glass-card rounded-xl p-3 z-10 shadow-lg text-xs flex-col gap-2 min-w-[150px]">
        {selectedMetric === 'pm2_5' && (
          <>
            <h5 className="font-bold text-slate-300 border-b border-slate-800 pb-1 mb-1">PM₂.₅ 圖例 (ug/m³)</h5>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-slate-400">良好 (0.0 ~ 15.4)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-slate-400">普通 (15.5 ~ 35.4)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-slate-400">敏感不健康 (35.5 ~ 54.4)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-slate-400">不健康 (54.5+)</span>
            </div>
          </>
        )}
        {selectedMetric === 'temperature' && (
          <>
            <h5 className="font-bold text-slate-300 border-b border-slate-800 pb-1 mb-1">溫度圖例 (°C)</h5>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-slate-400">涼爽 (&lt; 20.0)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-slate-400">舒適 (20.0 ~ 28.0)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-slate-400">偏熱 (28.1 ~ 35.0)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-slate-400">炎熱 (35.1+)</span>
            </div>
          </>
        )}
        {selectedMetric === 'humidity' && (
          <>
            <h5 className="font-bold text-slate-300 border-b border-slate-800 pb-1 mb-1">濕度圖例 (%)</h5>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-slate-400">乾燥 (&lt; 40)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-slate-400">舒適 (40 ~ 70)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-slate-400">潮濕 (71+)</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SensorMap;
