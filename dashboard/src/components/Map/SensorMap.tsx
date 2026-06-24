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
}

export const SensorMap: React.FC<SensorMapProps> = ({
  points,
  clusters,
  selectedSensorId,
  onSelectSensor,
  onMapClickCoords
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [id: string]: mapboxgl.Marker }>({});
  const [mapStyle, setMapStyle] = useState<'dark-v11' | 'satellite-streets-v12' | 'streets-v12'>('dark-v11');
  const [isLoaded, setIsLoaded] = useState(false);

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

    map.on('load', () => {
      mapRef.current = map;
      setIsLoaded(true);
      
      // 註冊地圖點擊事件，方便使用者框選位置新增事件
      map.on('click', (e) => {
        // 如果點擊的不是 marker，就觸發點擊地圖座標事件
        const target = e.originalEvent.target as HTMLElement;
        if (target && !target.closest('.mapboxgl-marker')) {
          onMapClickCoords?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // 2. 切換地圖風格
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    mapRef.current.setStyle(`mapbox://styles/mapbox/${mapStyle}`);
  }, [mapStyle, isLoaded]);

  // 3. 更新 Marker 點位與顏色
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    // 清除舊的 Markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    points.forEach((point) => {
      // 建立自訂 DOM 元素作為 Marker
      const el = document.createElement('div');
      el.className = `w-6 h-6 rounded-full border-2 border-slate-900 cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-125 hover:z-50`;
      
      // 根據測值設定顏色分級
      const val = point.pm2_5 || 0;
      let bgColor = 'bg-emerald-500'; // 正常 (0~15)
      if (val > 15 && val <= 35) bgColor = 'bg-yellow-500'; // 普通 (16~35)
      if (val > 35 && val <= 54) bgColor = 'bg-orange-500'; // 對敏感族群不健康 (36~54)
      if (val > 54) bgColor = 'bg-red-500 animate-pulse'; // 疑似排污高危險點 (54+)

      // 檢查是否含有 VOC 異常或溫度突升 (疑似燃燒)
      const isFire = point.anomalyType === '疑似露天燃燒';
      const isFactory = point.anomalyType === '疑似工廠排污';
      
      if (isFire) {
        el.className += ` ${bgColor} border-red-300 ring-4 ring-orange-500/30`;
        el.innerHTML = '🔥';
      } else if (isFactory) {
        el.className += ` ${bgColor} border-purple-300 ring-4 ring-purple-500/30`;
        el.innerHTML = '🏭';
      } else {
        el.className += ` ${bgColor}`;
        // 選取狀態的外觀
        if (point.id === selectedSensorId) {
          el.className += ' ring-4 ring-white scale-125 z-40';
        }
      }

      el.addEventListener('click', () => {
        onSelectSensor(point.id);
      });

      // 建立彈出氣泡窗
      const popup = new mapboxgl.Popup({ offset: 15 }).setHTML(`
        <div class="p-2 text-slate-900 font-sans">
          <h4 class="font-bold border-b pb-1 mb-1 text-slate-800">${point.name} (${point.id})</h4>
          <p class="text-xs text-slate-500 mb-1">區域：${point.county}</p>
          <div class="grid grid-cols-2 gap-1 text-xs">
            <span class="text-slate-600">PM2.5:</span>
            <span class="font-bold ${val > 54 ? 'text-red-600' : 'text-slate-800'}">${val} ug/m³</span>
            <span class="text-slate-600">溫度:</span>
            <span class="font-bold text-slate-800">${point.temperature !== null ? point.temperature + ' °C' : 'N/A'}</span>
            <span class="text-slate-600">濕度:</span>
            <span class="font-bold text-slate-800">${point.humidity !== null ? point.humidity + ' %' : 'N/A'}</span>
            <span class="text-slate-600">VOC:</span>
            <span class="font-bold text-slate-800">${point.voc !== null ? point.voc + ' ppm' : 'N/A'}</span>
          </div>
          ${point.anomalyType ? `<p class="mt-2 text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded text-center">🚨 警告：${point.anomalyType}</p>` : ''}
        </div>
      `);

      // 建立 Marker 並加入地圖
      const marker = new mapboxgl.Marker(el)
        .setLngLat([point.lon, point.lat])
        .setPopup(popup)
        .addTo(mapRef.current!);

      markersRef.current[point.id] = marker;
    });
  }, [points, selectedSensorId, isLoaded]);

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
          dominantType: cluster.dominantType
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
            <p class="text-[10px] text-slate-400 mt-1">半徑: ${clusters[0]?.radiusKm} km</p>
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

  }, [clusters, isLoaded]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* 地圖容器 */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* 無 API Key 警告 */}
      {!token && (
        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-50">
          <AlertTriangle className="text-amber-500 w-16 h-16 mb-4 animate-bounce" />
          <h3 class="text-xl font-bold text-white mb-2">未設定 Mapbox API Key</h3>
          <p class="text-slate-400 max-w-md text-sm mb-4">
            請在專案目錄下的 <code class="bg-slate-800 px-2 py-0.5 rounded text-orange-500">.env.local</code> 檔案中，將 Mapbox 的 Token 填入 <code class="bg-slate-800 px-2 py-0.5 rounded text-orange-500">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> 中。
          </p>
        </div>
      )}

      {/* 地圖樣式與控制面板 */}
      {token && (
        <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg p-2 flex items-center gap-2 z-10 shadow-lg text-xs">
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
      )}

      {/* 圖例說明 */}
      <div className="absolute bottom-4 left-4 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl p-3 z-10 shadow-lg text-xs flex flex-col gap-2 min-w-[150px]">
        <h5 className="font-bold text-slate-300 border-b border-slate-800 pb-1 mb-1">PM2.5 圖例</h5>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500" />
          <span className="text-slate-400">良好 (0 ~ 15)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="text-slate-400">普通 (16 ~ 35)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-orange-500" />
          <span className="text-slate-400">偏高 (36 ~ 54)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-slate-400">高污染 (54+)</span>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-800 pt-1.5 mt-0.5">
          <span>🔥</span>
          <span className="text-slate-300 font-medium">疑似露天燃燒</span>
        </div>
        <div className="flex items-center gap-2">
          <span>🏭</span>
          <span className="text-slate-300 font-medium">疑似工廠排污</span>
        </div>
      </div>
    </div>
  );
};

export default SensorMap;
