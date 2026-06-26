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
          else if (val <= 150.4) bgColor = 'bg-red-500'; // 對所有族群不健康
          else if (val <= 250.4) bgColor = 'bg-purple-500'; // 非常不健康
          else bgColor = 'bg-[#3f000f]'; // 危害
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
      } else if (selectedMetric === 'pm2_5' && val !== null && val !== undefined && val > 54.4) {
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
    if (selectedMetric === 'pm2_5') maxVal = 250.5;
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
              0.15, '#10b981', // 良好 (綠)
              0.3, '#eab308',  // 普通 (黃)
              0.45, '#f97316', // 敏感橘 (橘)
              0.6, '#ef4444',  // 不健康 (紅)
              0.8, '#a855f7',  // 非常不健康 (紫)
              1.0, '#3f000f'   // 危害 (危害深褐色/黑紅)
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
      (e as any)._layerClicked = true;
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      
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
              <span class="font-bold text-slate-200">${props.dominantType}</span>
              
              <span class="text-slate-500 font-semibold">涵蓋半徑:</span>
              <span class="font-bold text-slate-400">${props.radiusKm} km</span>
            </div>
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

      {renderScaleBar()}
    </div>
  );
};

export default SensorMap;
