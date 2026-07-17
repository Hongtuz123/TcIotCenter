'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Sensor, Cluster, Observation, Event, EventSensorDetail } from '@/types';
import { Layers, Flame, AlertTriangle, ShieldCheck, Compass, RotateCcw } from 'lucide-react';
import { useDispersionSim, getEventSourceSensor, getElevation } from './useDispersionSim';



// 取得落在擴散半徑範圍內的所有測站 (用於計算平均、最小、最大值)
const getEventSensorsInBounds = (
  event: Event | null | undefined,
  points: (Sensor & Observation)[]
): (Sensor & Observation)[] => {
  if (!event) return [];
  if (event.sensors && event.sensors.length > 0) {
    return event.sensors.map(s => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      county: s.county,
      status: s.status,
      pm2_5: s.pm2_5,
      temperature: s.temperature,
      humidity: s.humidity,
      voc: s.voc
    })) as any;
  }
  if (event.bounds?.center && points.length > 0) {
    const center = event.bounds.center;
    const centerLon = (center as any).lon ?? (center as any).lng;
    const centerLat = center.lat;
    const radiusKm = event.bounds.radiusKm ?? 1.0;
    if (centerLon && centerLat) {
      return points.filter(p => {
        const dLon = (p.lon - centerLon) * 111.32 * Math.cos(centerLat * Math.PI / 180);
        const dLat = (p.lat - centerLat) * 110.57;
        const dist = Math.sqrt(dLon * dLon + dLat * dLat);
        return dist <= radiusKm;
      });
    }
  }
  return [];
};



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
  /** 正在模擬的污染擴散事件（與風場流線互斥）*/
  dispersionEvent?: Event | null;
  onClearDispersion?: () => void;
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
  pm25Threshold,
  dispersionEvent,
  onClearDispersion
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const globalPopupRef = useRef<mapboxgl.Popup | null>(null);
  const isInternalClosingRef = useRef(false);
  const [mapStyle, setMapStyle] = useState<'dark-v11' | 'satellite-streets-v12' | 'streets-v12'>('dark-v11');
  const [isLoaded, setIsLoaded] = useState(false);
  const [showIndustrialZones, setShowIndustrialZones] = useState(true);
  const [showSensors, setShowSensors] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [show3DBuildings, setShow3DBuildings] = useState(false);
  const [show3DTerrain, setShow3DTerrain] = useState(false);
  const [show3DSky, setShow3DSky] = useState(false);
  const [showWindArrows, setShowWindArrows] = useState(false);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showBaseMapMenu, setShowBaseMapMenu] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [bearing, setBearing] = useState(0);
  const showIndustrialZonesRef = useRef(showIndustrialZones);
  const prevStyleRef = useRef(mapStyle);
  // 追蹤上一次篩選器狀態，避免 regionCenters 異步載入時觸發無效地圖重置
  const prevFilterRef = useRef(selectedFilter);

  // 風粒子動畫與風向向量快取 Ref
  const windAnimRef = useRef<number | null>(null);
  const windVectorsRef = useRef<{ id: string; lon: number; lat: number; dLon: number; dLat: number; hashOffset: number; ws: number }[]>([]);

  const [playTrigger, setPlayTrigger] = useState(0);

  // 污染擴散模擬相關 (委託自定義 Hook 管理)
  const {
    simTimeH,
    setSimTimeH,
    isSimPlaying,
    setIsSimPlaying,
    accumulatedTimeRef,
    simAnimRef,
    simPhaseRef,
    simStartTimeRef,
    simHoldStartRef
  } = useDispersionSim({
    map: mapRef.current,
    isLoaded,
    dispersionEvent,
    playTrigger,
    points,
    setShowWindArrows,
    windVectorsRef
  });

  // 用於驅動超標圓圈的外環動畫（WebGL 雷達脈衝環）
  const [pulseRadius, setPulseRadius] = useState(6);
  const [pulseOpacity, setPulseOpacity] = useState(0.8);

  useEffect(() => {
    let animId: number;
    const startTime = Date.now();
    const animatePulse = () => {
      const elapsed = Date.now() - startTime;
      const progress = (elapsed % 1600) / 1600; // 1.6秒一個循環
      setPulseRadius(6 + progress * 12); // 半徑 6 ~ 18
      setPulseOpacity(0.8 * (1 - progress)); // 透明度 0.8 ~ 0
      animId = requestAnimationFrame(animatePulse);
    };
    animId = requestAnimationFrame(animatePulse);
    return () => cancelAnimationFrame(animId);
  }, []);

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
    map.addControl(new mapboxgl.ScaleControl({
      maxWidth: 100,
      unit: 'metric'
    }), 'bottom-left');

    map.on('rotate', () => {
      setBearing(map.getBearing());
    });

    const circleColorExpression = [
      'case',
      ['==', ['get', 'isDispersionSource'], true], '#ffffff',
      ['==', ['get', 'value'], null], '#64748b',
      ['==', ['literal', selectedMetric], 'pm2_5'], [
        'step', ['get', 'value'],
        '#10b981', 15.5,
        '#eab308', 35.4,
        '#f97316', 54.4,
        '#ef4444', 150.4,
        '#a855f7', 250.4,
        '#3f000f'
      ],
      ['==', ['literal', selectedMetric], 'temperature'], [
        'step', ['get', 'value'],
        '#3b82f6', 20.0,
        '#10b981', 28.0,
        '#eab308', 35.0,
        '#ef4444'
      ],
      ['==', ['literal', selectedMetric], 'humidity'], [
        'step', ['get', 'value'],
        '#f97316', 40,
        '#10b981', 70,
        '#3b82f6'
      ],
      '#64748b'
    ] as any;

    const setupSensorsLayers = () => {
      const showSensorsLatest = showSensors;
      if (!map.getSource('sensors-source')) {
        map.addSource('sensors-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: []
          }
        });

        // 1. 雷達圈 (sensors-pings)
        map.addLayer({
          id: 'sensors-pings',
          type: 'circle',
          source: 'sensors-source',
          filter: ['==', ['get', 'isAnomaly'], true],
          paint: {
            'circle-radius': pulseRadius,
            'circle-opacity': pulseOpacity,
            'circle-color': [
              'case',
              ['==', ['get', 'anomalyType'], '疑似露天燃燒'], '#f97316',
              ['==', ['get', 'anomalyType'], '疑似工廠排污'], '#a855f7',
              '#ef4444'
            ],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': [
              'case',
              ['==', ['get', 'anomalyType'], '疑似露天燃燒'], '#f97316',
              ['==', ['get', 'anomalyType'], '疑似工廠排污'], '#a855f7',
              '#ef4444'
            ],
            'circle-stroke-opacity': pulseOpacity
          },
          layout: {
            visibility: showSensorsLatest ? 'visible' : 'none'
          }
        });

        // 2. 實心點 (sensors-circles)
        map.addLayer({
          id: 'sensors-circles',
          type: 'circle',
          source: 'sensors-source',
          paint: {
            'circle-color': circleColorExpression,
            'circle-radius': [
              'case',
              ['get', 'isDispersionSource'], 8,
              ['get', 'isSelected'], 8,
              ['get', 'isAnomaly'], 6.5,
              4
            ],
            'circle-stroke-width': [
              'case',
              ['get', 'isSelected'], 2,
              0.5
            ],
            'circle-stroke-color': [
              'case',
              ['get', 'isSelected'], '#ffffff',
              '#080c14'
            ]
          },
          layout: {
            visibility: showSensorsLatest ? 'visible' : 'none'
          }
        });

        // 點擊事件
        map.on('click', 'sensors-circles', (e) => {
          (e as any)._layerClicked = true;
          if (!e.features || e.features.length === 0) return;
          const id = e.features[0].properties?.id;
          if (id) {
            onSelectSensor(id);
          }
        });

        // Hover 游標
        map.on('mouseenter', 'sensors-circles', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'sensors-circles', () => {
          map.getCanvas().style.cursor = '';
        });
      }
    };

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

    const setup3DFeatures = () => {
      // 1. 註冊 DEM 地形資料源
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        });
      }

      // 同步套用 3D 地形
      if (show3DTerrain) {
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      } else {
        map.setTerrain(null);
      }

      // 同步套用 3D 天空大氣
      if (show3DSky) {
        map.setFog({
          color: '#080c14',
          'high-color': '#101726',
          'horizon-blend': 0.15,
          'space-color': '#010409',
          'star-intensity': 0.6
        });
      } else {
        map.setFog(null);
      }

      // 2. 註冊 3D 建築拉伸圖層 (複合底圖自帶)
      if (!map.getLayer('3d-buildings')) {
        const layers = map.getStyle().layers;
        const labelLayerId = layers?.find(
          (layer) => layer.type === 'symbol' && layer.layout?.['text-field']
        )?.id;

        map.addLayer(
          {
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 15,
            paint: {
              'fill-extrusion-color': '#33486c', // 稍加調亮，讓建物與地表對比更強烈
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15, 0,
                15.05, ['*', ['coalesce', ['get', 'height'], 15], 3.0] // fallback 15米並乘以 3.0倍拉伸
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15, 0,
                15.05, ['*', ['coalesce', ['get', 'min_height'], 0], 3.0]
              ],
              'fill-extrusion-opacity': 0.75
            },
            layout: {
              visibility: show3DBuildings ? 'visible' : 'none'
            }
          },
          labelLayerId
        );
      } else {
        map.setLayoutProperty('3d-buildings', 'visibility', show3DBuildings ? 'visible' : 'none');
      }
    };

    const setupWindLayers = () => {
      // 新增 Windy 全球風場式 Canvas 柵格渲染圖層
      if (!map.getSource('wind-canvas-source')) {
        map.addSource('wind-canvas-source', {
          type: 'canvas',
          canvas: 'wind-canvas',
          animate: true,
          coordinates: [
            [120.30, 24.45], // 西北 (左上)
            [120.98, 24.45], // 東北 (右上)
            [120.98, 23.85], // 東南 (右下)
            [120.30, 23.85]  // 西南 (左下)
          ]
        });

        map.addLayer({
          id: 'sensors-wind-canvas-layer',
          type: 'raster',
          source: 'wind-canvas-source',
          paint: {
            'raster-opacity': 0.85,
            'raster-fade-duration': 0
          },
          layout: {
            visibility: showWindArrows ? 'visible' : 'none'
          }
        });
      }
    };

    const setupDispersionLayer = () => {
      // 新增污染擴散模擬 Canvas 圖層
      if (!map.getSource('dispersion-canvas-source')) {
        map.addSource('dispersion-canvas-source', {
          type: 'canvas',
          canvas: 'dispersion-canvas',
          animate: true,
          coordinates: [
            [120.30, 24.45],
            [120.98, 24.45],
            [120.98, 23.85],
            [120.30, 23.85]
          ]
        });
        map.addLayer({
          id: 'dispersion-canvas-layer',
          type: 'raster',
          source: 'dispersion-canvas-source',
          paint: {
            'raster-opacity': 0.9,
            'raster-fade-duration': 0
          },
          layout: { visibility: 'none' }
        });
      }
    };

    map.on('load', () => {
      mapRef.current = map;
      (window as any).mapboxMap = map;
      setIsLoaded(true);
      console.log('Mapbox load event triggered.');
      setupIndustrialZones();
      setupSensorsLayers();
      setup3DFeatures();
      setupWindLayers();
      setupDispersionLayer();

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
      setupSensorsLayers();
      setup3DFeatures();
      setupWindLayers();
      setupDispersionLayer();
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

  // 2.6 同步控制 3D 建築拉伸圖層可見度 + 貼心相機引導
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    
    if (show3DBuildings) {
      if (!map.getLayer('3d-buildings')) {
        // 若圖層因風格載入尚未建立，重新觸發初始化
        setStyleVersion((v) => v + 1);
      } else {
        map.setLayoutProperty('3d-buildings', 'visibility', 'visible');
      }

      // 貼心引導：如果 zoom 不夠近，平滑拉近地圖以顯示 3D 建築 (minzoom 15)
      if (map.getZoom() < 15) {
        console.log('3D Buildings enabled: Zooming in to show buildings');
        map.flyTo({
          zoom: 15.2,
          pitch: 65,
          bearing: 15,
          duration: 2000,
          essential: true
        });
      }
    } else {
      if (map.getLayer('3d-buildings')) {
        map.setLayoutProperty('3d-buildings', 'visibility', 'none');
      }
    }
  }, [show3DBuildings, isLoaded]);

  // 2.7 同步控制 3D 立體地形圖層可見度 + 貼心相機引導
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    try {
      if (show3DTerrain) {
        if (!map.getSource('mapbox-dem')) {
          setStyleVersion((v) => v + 1);
        } else {
          map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        }

        // 貼心引導：如果 pitch (傾斜度) 不夠斜，平滑傾斜以顯現地貌起伏
        if (map.getPitch() < 45) {
          console.log('3D Terrain enabled: Tilting camera to show relief');
          map.flyTo({
            pitch: 60,
            bearing: -20,
            duration: 2000,
            essential: true
          });
        }
      } else {
        map.setTerrain(null);
      }
    } catch (err) {
      console.error('Error toggling terrain:', err);
    }
  }, [show3DTerrain, isLoaded]);

  // 2.8 同步控制 3D 天空與大氣層特效 + 貼心相機引導
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    try {
      if (show3DSky) {
        map.setFog({
          color: '#080c14',
          'high-color': '#101726',
          'horizon-blend': 0.15,
          'space-color': '#010409',
          'star-intensity': 0.6
        });

        // 貼心引導：如果 pitch 不夠，平滑傾斜以能看見地平線大氣
        if (map.getPitch() < 55) {
          console.log('3D Sky enabled: Tilting camera to show sky/fog');
          map.flyTo({
            pitch: 65,
            duration: 2000,
            essential: true
          });
        }
      } else {
        map.setFog(null);
      }
    } catch (err) {
      console.error('Error toggling fog:', err);
    }
  }, [show3DSky, isLoaded]);

  // 3. 更新 WebGL Sensor 資料源與當前選中/超標狀態
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    const source = map.getSource('sensors-source') as mapboxgl.GeoJSONSource;
    if (!source) return;

    const srcSensor = getEventSourceSensor(dispersionEvent, points);
    const srcSensorId = srcSensor?.id;

    // 建立 GeoJSON FeatureCollection
    const features: any = points.map((point) => {
      let val = point[selectedMetric];
      let isAnomalyPoint = point.isAnomaly;
      let anomalyType = point.anomalyType;

      // 污染擴散模擬中的測站測值動態漸進連動
      if (dispersionEvent && selectedMetric === 'pm2_5') {
        // 找到該測站在事件中的目標測值
        const evSensor = dispersionEvent.sensors?.find((s: any) => s.id === point.id);
        if (evSensor) {
          const targetPm25 = evSensor.pm2_5 ?? 54.0;
          const basePm25 = Math.min(12.0, targetPm25 * 0.2); // 預設乾淨背景值 (原值的 20% 或最高 12.0)
          
          if (point.id === srcSensorId) {
            // 源頭測站：0 ~ 0.5 小時內快速上升至最高
            const ratio = Math.min(1.0, simTimeH / 0.5);
            val = basePm25 + (targetPm25 - basePm25) * ratio;
          } else if (srcSensor) {
            // 其他測站：依距離源頭的遠近計算擴散延遲
            const dLon = (point.lon - srcSensor.lon) * 111.32 * Math.cos(srcSensor.lat * Math.PI / 180);
            const dLat = (point.lat - srcSensor.lat) * 110.57;
            const distKm = Math.sqrt(dLon * dLon + dLat * dLat);
            
            // 假設平均擴散波速為 6.0 km/h (即每分鐘 100 公尺)
            const tDelay = Math.min(3.0, distKm / 6.0);
            
            if (simTimeH < tDelay) {
              val = basePm25;
            } else {
              const ratio = Math.min(1.0, (simTimeH - tDelay) / Math.max(0.5, (4.0 - tDelay)));
              val = basePm25 + (targetPm25 - basePm25) * ratio;
            }
          }
          
          // 動態更新是否超標判定
          const isPm25Anomaly = val !== null && val !== undefined && val >= (pm25Threshold ?? 54);
          isAnomalyPoint = isPm25Anomaly;
          anomalyType = isAnomalyPoint ? `連續 3 筆 PM₂.₅ 超標` : '';
        }
      } else {
        // 非模擬模式下的正常超標判定
        const isPm25Anomaly = selectedMetric === 'pm2_5' && val !== null && val !== undefined && val >= (pm25Threshold ?? 54);
        isAnomalyPoint = point.isAnomaly || isPm25Anomaly;
      }

      const isDispersionSource = srcSensorId && point.id === srcSensorId;

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [point.lon, point.lat]
        },
        properties: {
          id: point.id,
          name: point.name,
          lat: point.lat,
          lon: point.lon,
          county: point.county,
          status: point.status,
          pm2_5: selectedMetric === 'pm2_5' ? val : point.pm2_5,
          temperature: point.temperature,
          humidity: point.humidity,
          voc: point.voc,
          time: point.time,
          isAnomaly: isAnomalyPoint,
          anomalyType: anomalyType,
          value: val,
          isSelected: point.id === selectedSensorId,
          isDispersionSource: !!isDispersionSource
        }
      };
    });

    source.setData({
      type: 'FeatureCollection',
      features: features
    });
  }, [points, isLoaded, selectedMetric, selectedSensorId, pm25Threshold, dispersionEvent, simTimeH]);

  // 3.1 更新風向向量快取 (供 Windy 全域插值粒子使用)
  useEffect(() => {
    if (!isLoaded) return;

    if (!showWindArrows || !points || points.length === 0) {
      windVectorsRef.current = [];
      return;
    }

    windVectorsRef.current = points.map((p: any) => {
      let ws = p.windSpeed ?? p.wind_speed ?? null;
      let wd = p.windDirection ?? p.wind_direction ?? null;
      
      // 前端動態模擬 Fallback 算法：基於地理位置分區模擬真實風場差異
      if (ws === null || wd === null || isNaN(ws) || isNaN(wd)) {
        const hour = new Date().getHours();
        const lon = p.lon ?? 120.65;
        const lat = p.lat ?? 24.15;

        // ── 依地理分區決定主風向 ──────────────────────────────────────────
        // 海線 (lon < 120.55)：白天海風 (約 250° 偏西)，夜間陸風 (約 60° 偏東)
        // 盆地平原 (120.55~120.75)：白天西南季風主導，夜間山谷下坡風
        // 山區 (lon > 120.75)：白天上坡谷風 (偏西北 290°)，夜間下坡風 (偏東南 110°)
        let baseWd: number;
        let baseWs: number;

        const isCoastal = lon < 120.55;
        const isMountain = lon > 120.75;
        const isDay = hour >= 7 && hour <= 18;

        if (isCoastal) {
          baseWd = isDay ? 250 : 65;      // 海線：白天偏西，夜間偏東
          baseWs = isDay ? 6.5 : 4.2;    // 海線風速較高
        } else if (isMountain) {
          baseWd = isDay ? 290 : 110;     // 山區：白天上坡風 NW，夜間下坡風 SE
          baseWs = isDay ? 3.8 : 2.5;    // 山區受地形遮蔽，風速中等
        } else {
          // 盆地：白天西南季風，夜間東北陸風
          baseWd = isDay ? 220 : 45;
          baseWs = isDay ? 5.0 : 3.5;
        }

        // 加入緯度修正：南部測站（台中港附近）偏南，北部（豐原、后里）偏北
        const latFactor = (lat - 24.15) * 15; // 緯度偏差修正 (±15°)
        baseWd = (baseWd + latFactor + 360) % 360;

        // 加入站點 hash 擾動，避免看起來完全整齊
        let hash = 0;
        const idStr = String(p.id || '');
        for (let i = 0; i < idStr.length; i++) {
          hash += idStr.charCodeAt(i);
        }
        const dirNoise = (hash % 41) - 20;  // ±20° 亂數擾動
        const spdNoise = ((hash % 31) - 15) / 10; // ±1.5 m/s 擾動
        wd = (baseWd + dirNoise + 360) % 360;
        ws = Math.max(1.5, baseWs + spdNoise);
      }

      const lon = p.lon;
      const lat = p.lat;

      const rad = ((wd + 180) * Math.PI) / 180;
      const scale = 0.00045 * ws;
      const endLon = lon + Math.sin(rad) * scale;
      const endLat = lat + Math.cos(rad) * scale;

      let hashVal = 0;
      const idStr = String(p.id || '');
      for (let i = 0; i < idStr.length; i++) {
        hashVal += idStr.charCodeAt(i);
      }
      const hashOffset = (hashVal % 100) / 100;

      return { id: p.id, lon, lat, dLon: endLon - lon, dLat: endLat - lat, hashOffset, ws };
    });
  }, [points, isLoaded, showWindArrows]);

  // 3.1.3 Windy 全景柵格動態風場動畫 (Canvas IDW 插值)
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    // 清除任何先前已有的動畫
    if ((window as any).windyAnimId) {
      cancelAnimationFrame((window as any).windyAnimId);
      (window as any).windyAnimId = null;
    }

    const canvas = document.getElementById('wind-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!showWindArrows) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const canvasSource = map.getSource('wind-canvas-source') as mapboxgl.CanvasSource;
      if (canvasSource) {
        canvasSource.play(); // 觸發重繪以隱藏
      }
      return;
    }

    // 粒子系統初始化
    const particleCount = 1800; // 粒子數量，1800 顆可保證密集度又兼顧效能
    const particles: { x: number; y: number; age: number; speed: number }[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        age: Math.floor(Math.random() * 800),
        speed: 0.5 + Math.random() * 1.5
      });
    }

    // 經緯度映射邊界 (台中地區)
    const minLon = 120.30;
    const maxLon = 120.98;
    const minLat = 23.85;
    const maxLat = 24.45;

    const lonWidth = maxLon - minLon;
    const latHeight = maxLat - minLat;

    // 反距離加權插值 (IDW) 取得特定位置風速與風速向量
    const getWindAt = (lon: number, lat: number) => {
      const vectors = windVectorsRef.current;
      if (vectors.length === 0) return { dLon: 0, dLat: 0, ws: 0 };

      let sumW = 0;
      let sumLon = 0;
      let sumLat = 0;
      let sumWs = 0;

      for (let i = 0; i < vectors.length; i++) {
        const v = vectors[i];
        const dLon = lon - v.lon;
        const dLat = lat - v.lat;
        const distSq = dLon * dLon + dLat * dLat;
        
        // 權重公式：1 / (距離平方 + 微小常數)
        const w = 1.0 / (distSq + 0.000001);
        sumW += w;
        sumLon += v.dLon * w;
        sumLat += v.dLat * w;
        sumWs += v.ws * w;
      }

      return {
        dLon: sumLon / sumW,
        dLat: sumLat / sumW,
        ws: sumWs / sumW
      };
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const step = () => {
      if (!mapRef.current) return;

      // 使用 destination-out 擦除法在透明 canvas 上畫出漂亮的漸慢淡出尾跡 (Windy 流沙線條)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'; // 數值越小尾巴越長
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';

      // 設置粒子基本線寬
      ctx.lineWidth = 1.2;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Canvas 坐報轉回經緯度
        const lon = minLon + (p.x / canvas.width) * lonWidth;
        const lat = maxLat - (p.y / canvas.height) * latHeight;

        const wind = getWindAt(lon, lat);

        // 根據插值得到的風速動態決定粒子流動顏色，與圖例 scale bar 一致
        let strokeColor = 'rgba(34, 211, 238, 0.7)'; // <= 2.0: 青色
        if (wind.ws > 12.0) {
          strokeColor = 'rgba(236, 72, 153, 0.85)'; // > 12.0: 品紅
        } else if (wind.ws > 8.0) {
          strokeColor = 'rgba(249, 115, 22, 0.8)';  // 8.0 ~ 12.0: 橘色
        } else if (wind.ws > 5.0) {
          strokeColor = 'rgba(251, 191, 36, 0.75)'; // 5.0 ~ 8.0: 黃色
        } else if (wind.ws > 2.0) {
          strokeColor = 'rgba(52, 211, 153, 0.75)'; // 2.0 ~ 5.0: 綠色
        }
        
        ctx.strokeStyle = strokeColor;

        // 將經緯度位移轉回像素位移 (速度調為 0.25 倍以維持極緩流動感)
        const dx = (wind.dLon / lonWidth) * canvas.width * 1.5 * p.speed;
        const dy = (wind.dLat / latHeight) * canvas.height * 1.5 * p.speed;

        const nextX = p.x + dx;
        const nextY = p.y - dy;

        // 畫線
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nextX, nextY);
        ctx.stroke();

        // 更新與重置
        p.x = nextX;
        p.y = nextY;
        p.age++;

        if (
          p.x < 0 ||
          p.x > canvas.width ||
          p.y < 0 ||
          p.y > canvas.height ||
          p.age > 800
        ) {
          p.x = Math.random() * canvas.width;
          p.y = Math.random() * canvas.height;
          p.age = 0;
        }
      }

      // 通知 Mapbox 重繪 Canvas 貼圖
      const canvasSource = map.getSource('wind-canvas-source') as mapboxgl.CanvasSource;
      if (canvasSource) {
        canvasSource.play();
      }

      (window as any).windyAnimId = requestAnimationFrame(step);
    };

    (window as any).windyAnimId = requestAnimationFrame(step);

    return () => {
      if ((window as any).windyAnimId) {
        cancelAnimationFrame((window as any).windyAnimId);
        (window as any).windyAnimId = null;
      }
    };
  }, [showWindArrows, isLoaded]);

  // 3.3 污染擴散模擬動畫已移至 useDispersionSim 自定義 Hook 中處理

  // 3.4 啟動擴散模擬時，自動關閉熱區圖層並強制開啟 3D 立體地形，結束時自動復原
  const prevDispersionRef = useRef<any>(null);
  const original3DTerrainRef = useRef<boolean>(show3DTerrain);
  useEffect(() => {
    if (dispersionEvent && !prevDispersionRef.current) {
      original3DTerrainRef.current = show3DTerrain;
      setShowHeatmap(false);
      setShow3DTerrain(true);
      if (mapRef.current) {
        mapRef.current.flyTo({
          pitch: 60,
          bearing: -20,
          duration: 1500,
          essential: true
        });
        try {
          if (mapRef.current.getLayer('active-event-fill-layer')) {
            mapRef.current.setPaintProperty('active-event-fill-layer', 'fill-opacity', 0.05);
          }
        } catch (e) {
          console.error('Error lowering fill-opacity:', e);
        }
      }
    } else if (!dispersionEvent && prevDispersionRef.current) {
      setShowHeatmap(true);
      setShow3DTerrain(original3DTerrainRef.current);
      if (mapRef.current) {
        try {
          if (mapRef.current.getLayer('active-event-fill-layer')) {
            mapRef.current.setPaintProperty('active-event-fill-layer', 'fill-opacity', 0.3);
          }
        } catch (e) {
          console.error('Error restoring fill-opacity:', e);
        }
      }
    }
    prevDispersionRef.current = dispersionEvent;
  }, [dispersionEvent]);

  // 3.2 同步控制風場 Canvas 柵格圖層可見度 + 貼心相機傾斜引導
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const visibility = showWindArrows ? 'visible' : 'none';

    try {
      if (map.getLayer('sensors-wind-canvas-layer')) {
        map.setLayoutProperty('sensors-wind-canvas-layer', 'visibility', visibility);
      }

      // 貼心引導：如果開啟且傾斜度不夠，平滑傾斜以顯現風向線的 3D 流動感
      if (showWindArrows) {
        if (map.getPitch() < 45) {
          console.log('3D Wind field enabled: Tilting camera to show flow lines');
          map.flyTo({
            pitch: 60,
            duration: 1500,
            essential: true
          });
        }
      }
    } catch (err) {
      console.error('Error toggling wind layers:', err);
    }
  }, [showWindArrows, isLoaded]);

  // 3.0.1 控制 WebGL 測站圖層可見度
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const visibility = showSensors ? 'visible' : 'none';
    if (map.getLayer('sensors-circles')) {
      map.setLayoutProperty('sensors-circles', 'visibility', visibility);
    }
    if (map.getLayer('sensors-pings')) {
      map.setLayoutProperty('sensors-pings', 'visibility', visibility);
    }
  }, [showSensors, isLoaded]);

  // 3.0.2 同步 WebGL 雷達圈脈衝動畫半徑與透明度
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    if (map.getLayer('sensors-pings')) {
      map.setPaintProperty('sensors-pings', 'circle-radius', pulseRadius);
      map.setPaintProperty('sensors-pings', 'circle-opacity', pulseOpacity);
      map.setPaintProperty('sensors-pings', 'circle-stroke-opacity', pulseOpacity);
    }
  }, [pulseRadius, pulseOpacity, isLoaded]);

  // 3.0.3 監聽指標切換，更新 WebGL 點位色彩 Expressions
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    const circleColorExpression = [
      'case',
      ['==', ['get', 'isDispersionSource'], true], '#ffffff',
      ['==', ['get', 'value'], null], '#64748b',
      ['==', ['literal', selectedMetric], 'pm2_5'], [
        'step', ['get', 'value'],
        '#10b981', 15.5,
        '#eab308', 35.4,
        '#f97316', 54.4,
        '#ef4444', 150.4,
        '#a855f7', 250.4,
        '#3f000f'
      ],
      ['==', ['literal', selectedMetric], 'temperature'], [
        'step', ['get', 'value'],
        '#3b82f6', 20.0,
        '#10b981', 28.0,
        '#eab308', 35.0,
        '#ef4444'
      ],
      ['==', ['literal', selectedMetric], 'humidity'], [
        'step', ['get', 'value'],
        '#f97316', 40,
        '#10b981', 70,
        '#3b82f6'
      ],
      '#64748b'
    ] as any;

    if (map.getLayer('sensors-circles')) {
      map.setPaintProperty('sensors-circles', 'circle-color', circleColorExpression);
    }
  }, [selectedMetric, isLoaded]);

  // 3.1 同步更新全域唯一 Popup 顯示狀態
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;

    if (selectedSensorId) {
      const point = points.find((p) => p.id === selectedSensorId);
      
      if (point) {
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
        
        const ws = (point as any).windSpeed ?? (point as any).wind_speed ?? null;
        const wd = (point as any).windDirection ?? (point as any).wind_direction ?? null;
        const wsStr = ws !== null && ws !== undefined ? `${ws} m/s` : 'N/A';
        const wdStr = wd !== null && wd !== undefined ? `${wd}°` : 'N/A';

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

              <span style="color:#64748b;font-weight:600;">風速:</span>
              <span style="font-weight:700;color:#22d3ee;">${wsStr}</span>

              <span style="color:#64748b;font-weight:600;">風向:</span>
              <span style="font-weight:700;color:#22d3ee;">${wdStr}</span>
            </div>
            ${point.anomalyType ? `<p style="margin-top:8px;font-size:11px;font-weight:700;color:#f87171;background:rgba(239,68,68,0.1);padding:3px 8px;border-radius:6px;text-align:center;border:1px solid rgba(239,68,68,0.2);">🚨 警告：${point.anomalyType}</p>` : ''}
          </div>
        `;

        globalPopupRef.current
          .setLngLat([point.lon, point.lat])
          .setHTML(popupHtml)
          .addTo(map);
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

    const point = points.find((p) => p.id === selectedSensorId);
    if (point) {
      console.log(`Zooming in to selected sensor ${selectedSensorId} at [${point.lon}, ${point.lat}]`);
      mapRef.current.flyTo({
        center: [point.lon, point.lat],
        zoom: 14.5,
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
    }
  }, [selectedSensorId, isLoaded, activeEvent, points]);

  // 3.5 更新核密度圖 (Heatmap Layer)
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    const srcSensor = getEventSourceSensor(dispersionEvent, points);
    const srcSensorId = srcSensor?.id;

    // 建立 GeoJSON FeatureCollection
    const features: any = points
      .map((pt) => {
        let val = pt[selectedMetric];

        // 污染擴散模擬中的熱區數值動態漸進連動
        if (dispersionEvent && selectedMetric === 'pm2_5') {
          const evSensor = dispersionEvent.sensors?.find((s: any) => s.id === pt.id);
          if (evSensor) {
            const targetPm25 = evSensor.pm2_5 ?? 54.0;
            const basePm25 = Math.min(12.0, targetPm25 * 0.2); // 預設乾淨背景值
            
            if (pt.id === srcSensorId) {
              const ratio = Math.min(1.0, simTimeH / 0.5);
              val = basePm25 + (targetPm25 - basePm25) * ratio;
            } else if (srcSensor) {
              const dLon = (pt.lon - srcSensor.lon) * 111.32 * Math.cos(srcSensor.lat * Math.PI / 180);
              const dLat = (pt.lat - srcSensor.lat) * 110.57;
              const distKm = Math.sqrt(dLon * dLon + dLat * dLat);
              const tDelay = Math.min(3.0, distKm / 6.0);
              
              if (simTimeH < tDelay) {
                val = basePm25;
              } else {
                const ratio = Math.min(1.0, (simTimeH - tDelay) / Math.max(0.5, (4.0 - tDelay)));
                val = basePm25 + (targetPm25 - basePm25) * ratio;
              }
            }
          }
        }

        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [pt.lon, pt.lat]
          },
          properties: {
            id: pt.id,
            value: val
          }
        };
      })
      .filter((feat) => {
        const val = feat.properties.value;
        return val !== null && val !== undefined && !isNaN(val);
      });

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
      type: 'Feature' as const,
      properties: {
        id: activeEvent.id,
        radiusKm: radius
      },
      geometry: {
        type: 'Polygon' as const,
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

      // 紅色半透明填充 (若在擴散模擬中，降低不透明度至 0.05，以便看清底下擴散顏色)
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#ef4444',
          'fill-opacity': dispersionEvent ? 0.05 : 0.3
        }
      });

      // 紅色虛線描邊
      map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ef4444',
          'line-width': 2.5,
          'line-dasharray': [3, 2]
        }
      });
    }
  }, [activeEvent, isLoaded, styleVersion, dispersionEvent]);

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
      const isSimulating = !!dispersionEvent;
      mapRef.current.flyTo({
        center: [lng, lat],
        zoom: 14.5,
        pitch: isSimulating ? 60 : mapRef.current.getPitch(),
        bearing: isSimulating ? -20 : mapRef.current.getBearing(),
        speed: 1.2,
        curve: 1.4,
        essential: true
      });
    }
  }, [activeEvent, isLoaded, dispersionEvent]);

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
      <div className="glass-card rounded-xl p-3 shadow-lg text-xs flex flex-col gap-2 min-w-[240px] max-w-[280px] border border-slate-800 bg-slate-950/80 backdrop-blur-md">
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

  const renderWindScaleBar = () => {
    const windGradientStyle = 'linear-gradient(to right, rgba(34, 211, 238, 0.7), rgba(52, 211, 153, 0.7), rgba(251, 191, 36, 0.7), rgba(249, 115, 22, 0.7), rgba(236, 72, 153, 0.8))';
    const steps = [
      { label: '0' },
      { label: '2' },
      { label: '5' },
      { label: '8' },
      { label: '12+' }
    ];

    return (
      <div className="glass-card rounded-xl p-3 shadow-lg text-xs flex flex-col gap-2 min-w-[240px] max-w-[280px] border border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-0.5">
          <h5 className="font-bold text-slate-200">風速 Scale bar</h5>
          <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded-full font-semibold">
            m/s
          </span>
        </div>
        
        {/* 顏色漸層條 */}
        <div className="relative my-0.5">
          <div 
            className="w-full h-3 rounded-full shadow-inner border border-slate-800/80" 
            style={{ background: windGradientStyle }}
          />
        </div>

        {/* 顏色對應的測值切點 */}
        <div className="flex justify-between text-[9px] text-slate-400 font-bold px-0.5 mb-0.5">
          {steps.map((step, idx) => (
            <span key={idx}>{step.label}</span>
          ))}
        </div>

        {/* 風速說明 */}
        <div className="bg-slate-900/60 rounded-lg p-2 text-[10px] text-slate-500 flex justify-between leading-tight border border-slate-800/50">
          <span>青藍：微風 (0~2)</span>
          <span>綠黃：和風 (2~5)</span>
          <span>黃橘：清風/強風</span>
        </div>
      </div>
    );
  };

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* 地圖容器 */}
      <div ref={mapContainerRef} className="w-full h-full" />
      <canvas id="wind-canvas" width="1024" height="1024" style={{ display: 'none' }} />
      <canvas id="dispersion-canvas" width="1024" height="1024" style={{ display: 'none' }} />

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

              <div className="h-px bg-slate-800/60 w-full" />

              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={show3DBuildings}
                  onChange={(e) => setShow3DBuildings(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                3D 建築拉伸
              </label>

              <div className="h-px bg-slate-800/60 w-full" />

              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={show3DTerrain}
                  onChange={(e) => setShow3DTerrain(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                3D 立體地形
              </label>

              <div className="h-px bg-slate-800/60 w-full" />

              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={show3DSky}
                  onChange={(e) => setShow3DSky(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                3D 天空大氣
              </label>

              <div className="h-px bg-slate-800/60 w-full" />

              <label
                className={`flex items-center gap-2 font-semibold select-none text-[11px] transition-colors ${
                  dispersionEvent
                    ? 'text-slate-600 cursor-not-allowed'
                    : 'text-slate-300 cursor-pointer hover:text-slate-100'
                }`}
                title={dispersionEvent ? '擴散模擬進行中，請先關閉模擬才能開啟風場' : undefined}
              >
                <input
                  type="checkbox"
                  checked={showWindArrows}
                  disabled={!!dispersionEvent}
                  onChange={(e) => setShowWindArrows(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                />
                3D 風向流線
                {dispersionEvent && <span className="text-[9px] text-slate-600 ml-auto">(模擬中)</span>}
              </label>
            </div>
          )}

        </div>
      )}

      {/* 污染擴散模擬浮動面板 */}
      {dispersionEvent && (() => {
        const srcSensor = getEventSourceSensor(dispersionEvent, points);
        const srcPm25 = srcSensor?.pm2_5 ?? 0;
        const hours = Math.floor(simTimeH);
        const mins = Math.floor((simTimeH - hours) * 60);
        let pmColor = '#10b981';
        if (srcPm25 >= 54.4) pmColor = '#ef4444';
        else if (srcPm25 >= 35.4) pmColor = '#f97316';
        else if (srcPm25 >= 15.5) pmColor = '#eab308';

        // 取得事件範圍內的所有測站並計算 PM2.5 平均值、最小值、最大值
        const eventSensors = getEventSensorsInBounds(dispersionEvent, points);
        const pmValues = eventSensors
          .map(s => s.pm2_5)
          .filter((val): val is number => val !== null && val !== undefined);
        
        let avgPm = 0;
        let minPm = 0;
        let maxPm = 0;
        if (pmValues.length > 0) {
          avgPm = pmValues.reduce((sum, v) => sum + v, 0) / pmValues.length;
          minPm = Math.min(...pmValues);
          maxPm = Math.max(...pmValues);
        }

        return (
          <div className="absolute bottom-28 left-4 z-20 bg-slate-950/90 backdrop-blur-md border border-orange-500/40 rounded-2xl p-4 shadow-2xl min-w-[260px] max-w-[300px] flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-lg">🌫️</span>
                <h4 className="text-xs font-bold text-orange-400">污染擴散模擬</h4>
              </div>
              <div className="flex items-center gap-2">
                {/* 播放 / 暫停按鈕 */}
                <button
                  onClick={() => {
                    if (simTimeH >= 4.0) {
                      // 若已播畢則從頭重新開始播放
                      if (simAnimRef.current) {
                        cancelAnimationFrame(simAnimRef.current);
                        simAnimRef.current = null;
                      }
                      simPhaseRef.current = 'animating';
                      simStartTimeRef.current = null;
                      simHoldStartRef.current = null;
                      accumulatedTimeRef.current = 0;
                      setSimTimeH(0);
                      setIsSimPlaying(true);
                    } else {
                      setIsSimPlaying(!isSimPlaying);
                    }
                  }}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors flex items-center justify-center ${isSimPlaying ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}
                  title={isSimPlaying ? '暫停擴散模擬' : '播放擴散模擬'}
                >
                  {isSimPlaying ? (
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  )}
                </button>

                <button
                  onClick={() => {
                    // 1. 立即同步取消任何現有 RAF，防止舊回調重新繪製 4h 畫面
                    if (simAnimRef.current) {
                      cancelAnimationFrame(simAnimRef.current);
                      simAnimRef.current = null;
                    }
                    // 2. 同步重置所有動畫 phase 與計時 ref
                    simPhaseRef.current = 'animating';
                    simStartTimeRef.current = null;
                    simHoldStartRef.current = null;
                    accumulatedTimeRef.current = 0;
                    // 3. 清空畫布（此時已無 any 舊 RAF 能再次污染畫布）
                    const dispCanvas = document.getElementById('dispersion-canvas') as HTMLCanvasElement | null;
                    if (dispCanvas) {
                      dispCanvas.getContext('2d')?.clearRect(0, 0, dispCanvas.width, dispCanvas.height);
                    }
                    // 4. 重置顯示時間後觸發重播
                    setSimTimeH(0);
                    setPlayTrigger(prev => prev + 1);
                  }}
                  className="text-slate-500 hover:text-orange-400 p-1.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer transition-colors flex items-center justify-center"
                  title="重新播放"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onClearDispersion?.()}
                  className="text-slate-500 hover:text-slate-350 p-1.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer text-xs font-bold leading-none flex items-center justify-center h-7.5 w-7.5"
                  title="關閉模擬"
                >✕</button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-[11px] border-b border-slate-800 pb-2">
              <div className="flex justify-between">
                <span className="text-slate-500">污染來源</span>
                <span className="text-slate-200 font-semibold truncate max-w-[150px]">{srcSensor?.name ?? '未知'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">源頭 PM₂.₅</span>
                <span className="font-bold" style={{ color: pmColor }}>{srcPm25 ? `${srcPm25.toFixed(1)} μg/m³` : 'N/A'}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-[11px] border-b border-slate-800 pb-2">
              <div className="text-[10px] text-slate-400 font-bold mb-0.5">影響範圍內測站 ({eventSensors.length} 站)</div>
              <div className="flex justify-between">
                <span className="text-slate-500">平均 PM₂.₅</span>
                <span className="text-slate-200 font-semibold">{pmValues.length > 0 ? `${avgPm.toFixed(1)} μg/m³` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">最小 PM₂.₅</span>
                <span className="text-emerald-400 font-semibold">{pmValues.length > 0 ? `${minPm.toFixed(1)} μg/m³` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">最大 PM₂.₅</span>
                <span className="text-red-400 font-semibold">{pmValues.length > 0 ? `${maxPm.toFixed(1)} μg/m³` : 'N/A'}</span>
              </div>
            </div>
            {/* 時間進度條 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-400 font-semibold">模擬時間</span>
                <span className="text-orange-400 font-bold tabular-nums">
                  {simTimeH >= 3.98 ? '4h 00m ✓' : `${hours}h ${String(mins).padStart(2,'0')}m`}
                </span>
              </div>
              <div className="relative w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all"
                  style={{
                    width: `${(simTimeH / 4) * 100}%`,
                    background: 'linear-gradient(to right, #10b981, #eab308, #f97316, #ef4444)'
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-slate-600">
                <span>0h</span><span>1h</span><span>2h</span><span>3h</span><span>4h</span>
              </div>
            </div>
            <div className="text-[9px] text-slate-600 italic">
              ※ 基於 Gaussian Puff 模型，僅供參考
            </div>
          </div>
        );
      })()}

      <div className="absolute bottom-4 right-4 flex flex-col gap-2.5 z-10 items-end">
        {/* 指標熱區圖例 */}
        {renderScaleBar()}
        
        {/* Windy 風速風向圖例 */}
        {showWindArrows && renderWindScaleBar()}
      </div>
    </div>
  );
};

export default SensorMap;
