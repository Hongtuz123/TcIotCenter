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

    map.on('rotate', () => {
      setBearing(map.getBearing());
    });

    const circleColorExpression = [
      'case',
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
      if (!map.getSource('wind-source')) {
        map.addSource('wind-source', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: []
          }
        });

        // 1. 風場虛線圖層
        map.addLayer({
          id: 'sensors-wind-lines',
          type: 'line',
          source: 'wind-source',
          paint: {
            'line-color': '#06b6d4',
            'line-width': 1.5,
            'line-opacity': 0.65,
            'line-dasharray': [4, 2]
          },
          layout: {
            visibility: showWindArrows ? 'visible' : 'none'
          }
        });

        // 2. 風向流線末端圓點粒子
        map.addLayer({
          id: 'sensors-wind-dots',
          type: 'circle',
          source: 'wind-source',
          paint: {
            'circle-radius': 1.8,
            'circle-color': '#22d3ee',
            'circle-opacity': 0.8
          },
          layout: {
            visibility: showWindArrows ? 'visible' : 'none'
          }
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

    // 建立 GeoJSON FeatureCollection
    const features: any = points.map((point) => {
      const val = point[selectedMetric];
      const isPm25Anomaly = selectedMetric === 'pm2_5' && val !== null && val !== undefined && val >= (pm25Threshold ?? 54);
      const isAnomalyPoint = point.isAnomaly || isPm25Anomaly;

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
          pm2_5: point.pm2_5,
          temperature: point.temperature,
          humidity: point.humidity,
          voc: point.voc,
          time: point.time,
          isAnomaly: isAnomalyPoint,
          anomalyType: point.anomalyType,
          value: val,
          isSelected: point.id === selectedSensorId
        }
      };
    });

    source.setData({
      type: 'FeatureCollection',
      features: features
    });
  }, [points, isLoaded, selectedMetric, selectedSensorId, pm25Threshold]);

  // 3.1 更新風向虛擬流線資料源 (wind-source)
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const source = map.getSource('wind-source') as mapboxgl.GeoJSONSource;
    if (!source) return;

    if (!showWindArrows || !points || points.length === 0) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const windFeatures = points
      .map((p: any) => {
        const ws = p.windSpeed ?? p.wind_speed ?? null;
        const wd = p.windDirection ?? p.wind_direction ?? null;
        if (ws === null || wd === null || isNaN(ws) || isNaN(wd)) return null;

        const lon = p.lon;
        const lat = p.lat;

        // 計算風向下游的偏移向量 (風吹向的方向)
        // 角度為風向角 (從哪裡吹來)，所以風向指向 = 風向角 + 180 度 (風吹去的方向)
        const rad = ((wd + 180) * Math.PI) / 180;
        
        // 為了讓 3D 地圖上看起來有適當的比例，我們把風速換算為經緯度距離偏移
        // 風速 1 m/s 對應約 0.00018 經緯度偏移度
        const scale = 0.00018 * ws;
        const endLon = lon + Math.sin(rad) * scale;
        const endLat = lat + Math.cos(rad) * scale;

        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[lon, lat], [endLon, endLat]]
          },
          properties: {
            id: p.id,
            windSpeed: ws,
            windDirection: wd
          }
        };
      })
      .filter(Boolean) as any[];

    source.setData({
      type: 'FeatureCollection',
      features: windFeatures
    });
  }, [points, isLoaded, showWindArrows]);

  // 3.2 同步控制風場虛線與粒子圖層可見度 + 貼心相機傾斜引導
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const visibility = showWindArrows ? 'visible' : 'none';

    try {
      if (map.getLayer('sensors-wind-lines')) {
        map.setLayoutProperty('sensors-wind-lines', 'visibility', visibility);
      }
      if (map.getLayer('sensors-wind-dots')) {
        map.setLayoutProperty('sensors-wind-dots', 'visibility', visibility);
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
            \${point.anomalyType ? \`<p style="margin-top:8px;font-size:11px;font-weight:700;color:#f87171;background:rgba(239,68,68,0.1);padding:3px 8px;border-radius:6px;text-align:center;border:1px solid rgba(239,68,68,0.2);">🚨 警告：\${point.anomalyType}</p>\` : ''}
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

      // 紅色半透明填充
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#ef4444',
          'fill-opacity': 0.3
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

              <label className="flex items-center gap-2 text-slate-300 font-semibold cursor-pointer select-none text-[11px] hover:text-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={showWindArrows}
                  onChange={(e) => setShowWindArrows(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-orange-500 bg-slate-950 w-3.5 h-3.5 cursor-pointer"
                />
                3D 風向流線
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
