'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import FilterPanel from '@/components/Sidebar/FilterPanel';
import SensorMap from '@/components/Map/SensorMap';
import EventManager from '@/components/EventList/EventManager';
import TrendChart from '@/components/Analytics/TrendChart';
import { getEventSourceSensor } from '@/components/Map/useDispersionSim';
import { Sensor, Observation, Event, Cluster, SystemSettings } from '@/types';
import { Play, Pause, RotateCcw, ShieldAlert, Radio, Settings, X } from 'lucide-react';

// 取得當前台北時間（可傳入 offset 毫秒）並對齊到 5 分鐘
const getTaipeiTime = (offsetMs = 0): string => {
  const d = new Date(Date.now() + offsetMs);
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const getVal = (type: string) => parts.find(p => p.type === type)?.value || '';
  const year = getVal('year');
  const month = getVal('month');
  const day = getVal('day');
  const hour = getVal('hour');
  const minute = getVal('minute');
  const minNum = parseInt(minute, 10);
  const alignedMin = String(Math.floor(minNum / 5) * 5).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${alignedMin}`;
};

// 全域快取：行政區與產業園區的幾何計算結果，避免重複 Mount 時重複計算
let globalZoneMap: { [id: string]: string } | null = null;
let globalZoneNames: string[] | null = null;
let globalRegionCenters: { [key: string]: [number, number] } | null = null;

export default function DashboardPage() {
  // 時間對齊輔助函數：將 YYYY-MM-DDTHH:mm 無條件捨去至最近的 5 分鐘
  const alignTo5Minutes = (datetimeStr: string): string => {
    if (!datetimeStr) return datetimeStr;
    try {
      const [datePart, timePart] = datetimeStr.split('T');
      if (!timePart) return datetimeStr;
      const [hour, minute] = timePart.split(':');
      const minNum = parseInt(minute, 10);
      if (isNaN(minNum)) return datetimeStr;
      
      const alignedMin = String(Math.floor(minNum / 5) * 5).padStart(2, '0');
      return `${datePart}T${hour}:${alignedMin}`;
    } catch {
      return datetimeStr;
    }
  };

  const [isMounted, setIsMounted] = useState(false);

  // 篩選與播放狀態
  const [selectedFilter, setSelectedFilter] = useState<{ type: 'all' | 'county' | 'zone'; value: string }>({ type: 'all', value: '' });
  const [selectedDeviceId, setSelectedDeviceId] = useState('all');
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);
  
  // 開始時間、結束時間與當前播放時間
  const [startDateTime, setStartDateTime] = useState('2026-07-10T00:00');
  const [endDateTime, setEndDateTime] = useState('2026-07-10T23:59');
  const [currentDateTime, setCurrentDateTimeRaw] = useState('2026-07-10T12:00');
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [dispersionEvent, setDispersionEvent] = useState<Event | null>(null);
  const [showHistoryBanner, setShowHistoryBanner] = useState(false);
  const setCurrentDateTime = (val: string | ((prev: string) => string)) => {
    if (typeof val === 'function') {
      setCurrentDateTimeRaw((prev) => alignTo5Minutes(val(prev)));
    } else {
      setCurrentDateTimeRaw(alignTo5Minutes(val));
    }
  };

  // 將 YYYY-MM-DDTHH:mm 轉成 API 所需之 YYYY-MM-DD HH:mm:00
  const currentTime = currentDateTime.replace('T', ' ') + ':00';

  const [debouncedTime, setDebouncedTime] = useState(currentTime);

  const maxEndDateTime = isMounted ? getTaipeiTime() : '2026-06-26T23:59';
  const [selectedMetric, setSelectedMetric] = useState<'pm2_5' | 'temperature' | 'humidity'>('pm2_5');
  const [sensorZoneMap, setSensorZoneMap] = useState<{ [id: string]: string }>({});
  const [zoneNames, setZoneNames] = useState<string[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [regionCenters, setRegionCenters] = useState<{ [key: string]: [number, number] }>({});
  const [minVal, setMinVal] = useState(0);
  const [maxVal, setMaxVal] = useState(300);

  // 資料狀態
  const [points, setPoints] = useState<(Sensor & Observation)[]>([]);
  const [allSensors, setAllSensors] = useState<Sensor[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [clusters24h, setClusters24h] = useState<Cluster[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [historyData, setHistoryData] = useState<Observation[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => {
    if (typeof window !== 'undefined') {
      const pm25 = localStorage.getItem('pm25_threshold');
      const consecutive = localStorage.getItem('consecutive_exceeds');
      const radius = localStorage.getItem('cluster_radius_km');
      const minStations = localStorage.getItem('min_cluster_stations');
      if (pm25) {
        return {
          pm25_threshold: parseFloat(pm25),
          consecutive_exceeds: parseInt(consecutive || '3', 10),
          cluster_radius_km: parseFloat(radius || '1.0'),
          min_cluster_stations: parseInt(minStations || '2', 10)
        };
      }
    }
    return {
      pm25_threshold: 54,
      consecutive_exceeds: 3,
      cluster_radius_km: 1.0,
      min_cluster_stations: 2
    };
  });

  // UI 狀態
  const [isLoadingPoints, setIsLoadingPoints] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevSensorIdRef = useRef<string | null>(null);

  // 快取：測站 7 天歷史趨勢資料
  const historyCacheRef = useRef<Record<string, Observation[]>>({});

  // 播放速度控制 (1x / 2x / 4x)
  const [playSpeed, setPlaySpeed] = useState<1 | 2 | 4>(1);
  const playSpeedRef = useRef<number>(1);
  useEffect(() => {
    playSpeedRef.current = playSpeed;
  }, [playSpeed]);

  // 完整率狀態
  const [completeness, setCompleteness] = useState<{
    rate: number | null;
    mode: string;
    total_sensors: number;
    online_count: number;
    offline_count: number;
  } | null>(null);

  // 時間防抖：拖曳時防抖 250ms，自動播放時 0ms 即時反應
  useEffect(() => {
    if (isPlaying) {
      setDebouncedTime(currentTime);
      return;
    }

    const handler = setTimeout(() => {
      setDebouncedTime(currentTime);
    }, 250);

    return () => clearTimeout(handler);
  }, [currentTime, isPlaying]);

  // 當執行非擴散模擬功能時（如切換篩選條件、觀測指標、時間範圍、檢視其他事件或其它測站），自動關掉擴散模擬
  useEffect(() => {
    if (!dispersionEvent) return;

    // 1. 若當前檢視的歷史事件改變且非該擴散事件，則關閉
    if (activeEventId !== dispersionEvent.id) {
      setDispersionEvent(null);
      return;
    }

    // 2. 若選取了非擴散源頭的其它測站，則關閉
    const srcSensor = getEventSourceSensor(dispersionEvent, points);
    if (selectedSensorId && selectedSensorId !== srcSensor?.id) {
      setDispersionEvent(null);
    }
  }, [activeEventId, selectedSensorId, points, dispersionEvent]);

  // 對於篩選條件、觀測指標、時間範圍的變動，直接關閉擴散模擬
  useEffect(() => {
    if (dispersionEvent) {
      setDispersionEvent(null);
    }
  }, [selectedFilter, selectedDeviceId, selectedMetric, startDateTime, endDateTime]);

  // 0. 事件管理 API 串接 (提前宣告避免 Hoisting 錯誤)
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      if (Array.isArray(data)) {
        setEvents(data);
      }
    } catch (e) {
      console.error('載入事件失敗:', e);
    }
  }, []);

  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);

  // 1. 初始化行政區列表、系統設定與當前使用者身份
  useEffect(() => {
    fetch('/api/login')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setCurrentUser({ username: data.username, role: data.role });
        }
      })
      .catch(err => console.error('獲取使用者身份失敗:', err));

    const isPointInPolygon = (point: [number, number], vs: [number, number][]) => {
      const x = point[0], y = point[1];
      let inside = false;
      for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // 標記為已掛載，開始在 Client-side 計算當前時間並避免 Hydration Mismatch
    setIsMounted(true);

    const endVal = getTaipeiTime();
    const startVal = getTaipeiTime(-24 * 60 * 60 * 1000); // 往回 24h

    setEndDateTime(endVal);
    setStartDateTime(startVal);
    setCurrentDateTime(endVal);

    const initData = async () => {
      try {
        // 優先取得系統閾值設定，以便儘快更新 UI
        const settingsRes = await fetch('/api/settings');
        const settingsData = await settingsRes.json();
        if (settingsData && settingsData.pm25_threshold) {
          const pm25Val = parseFloat(settingsData.pm25_threshold);
          const consecutiveVal = parseInt(settingsData.consecutive_exceeds || '3', 10);
          const radiusVal = parseFloat(settingsData.cluster_radius_km);
          const minStationsVal = parseInt(settingsData.min_cluster_stations, 10);

          setSystemSettings({
            pm25_threshold: pm25Val,
            consecutive_exceeds: consecutiveVal,
            cluster_radius_km: radiusVal,
            min_cluster_stations: minStationsVal
          });

          if (typeof window !== 'undefined') {
            localStorage.setItem('pm25_threshold', pm25Val.toString());
            localStorage.setItem('consecutive_exceeds', consecutiveVal.toString());
            localStorage.setItem('cluster_radius_km', radiusVal.toString());
            localStorage.setItem('min_cluster_stations', minStationsVal.toString());
          }
        }

        // 取得所有感測器以提取行政區列表
        const res = await fetch('/api/sensors');
        const sensorsData: Sensor[] = await res.json();
        setAllSensors(sensorsData);
        const extractedCounties = Array.from(new Set(sensorsData.map((s) => s.county))).filter(Boolean);
        setCounties(extractedCounties);

        if (globalZoneMap && globalZoneNames && globalRegionCenters) {
          setZoneNames(globalZoneNames);
          setSensorZoneMap(globalZoneMap);
          setRegionCenters(globalRegionCenters);
        } else {
          // 載入產業園區 GeoJSON 並做 Point-in-Polygon 幾何判斷
          const geoRes = await fetch('/industrial-zones.geojson');
          const geojson = await geoRes.json();
          const zones: string[] = [];
          const zoneMap: { [id: string]: string } = {};
          const centers: { [key: string]: [number, number] } = {};

          // 1. 計算行政區的中心座標 (以測點平均經緯度)
          extractedCounties.forEach((county) => {
            const countyPts = sensorsData.filter((s) => s.county === county);
            if (countyPts.length > 0) {
              const avgLon = countyPts.reduce((sum, p) => sum + p.lon, 0) / countyPts.length;
              const avgLat = countyPts.reduce((sum, p) => sum + p.lat, 0) / countyPts.length;
              centers[`county_${county}`] = [avgLon, avgLat];
            }
          });

          if (geojson && geojson.features) {
            geojson.features.forEach((feature: any) => {
              const zoneName = feature.properties.name;
              if (zoneName && !zones.includes(zoneName)) {
                zones.push(zoneName);
              }
              const geom = feature.geometry;

              // 2. 計算園區幾何中心 (多邊形頂點平均經緯度)
              let sumLon = 0, sumLat = 0, count = 0;
              const processCoords = (ring: [number, number][]) => {
                ring.forEach(([lon, lat]) => {
                  sumLon += lon;
                  sumLat += lat;
                  count++;
                });
              };
              if (geom.type === 'Polygon') {
                geom.coordinates.forEach(processCoords);
              } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach((poly: any) => poly.forEach(processCoords));
              }
              if (count > 0 && zoneName) {
                centers[`zone_${zoneName}`] = [sumLon / count, sumLat / count];
              }

              sensorsData.forEach((sensor) => {
                const pt: [number, number] = [sensor.lon, sensor.lat];
                let inZone = false;
                if (geom.type === 'Polygon') {
                  inZone = geom.coordinates.some((ring: any) => isPointInPolygon(pt, ring));
                } else if (geom.type === 'MultiPolygon') {
                  inZone = geom.coordinates.some((poly: any) => 
                    poly.some((ring: any) => isPointInPolygon(pt, ring))
                  );
                }
                if (inZone) {
                  zoneMap[sensor.id] = zoneName;
                }
              });
            });
          }
          const sortedZones = zones.sort();
          setZoneNames(sortedZones);
          setSensorZoneMap(zoneMap);
          setRegionCenters(centers);

          // 寫入快取
          globalZoneMap = zoneMap;
          globalZoneNames = sortedZones;
          globalRegionCenters = centers;
        }
      } catch (e) {
        console.error('初始化失敗:', e);
      }
    };

    initData();
    fetchEvents();

  }, []);

  // currentTime 由 timeOffsetMin 直接衍生，無需額外 useEffect

  // 2. 當時間改變時，載入感測點觀測值與異常聚類
  useEffect(() => {
    const fetchPoints = async () => {
      setIsLoadingPoints(true);
      try {
        const isHist = debouncedTime !== maxEndDateTime;
        const res = await fetch(
          `/api/anomalies?time=${encodeURIComponent(debouncedTime)}` +
            `&radius=${systemSettings.cluster_radius_km}` +
            `&min_stations=${systemSettings.min_cluster_stations}` +
            `&pm25_threshold=${systemSettings.pm25_threshold}` +
            `&consecutive_exceeds=${systemSettings.consecutive_exceeds}` +
            `&is_historical=${isHist}`
        );
        const data = await res.json();
        
        if (data.points) {
          setPoints(data.points);
        }
        if (data.clusters) {
          setClusters(data.clusters);
        }
        // 自動事件建立後，立即重整事件列表以反映最新狀態
        fetchEvents();
      } catch (e) {
        console.error('載入點位失敗:', e);
      } finally {
        setIsLoadingPoints(false);
      }
    };

    fetchPoints();
  }, [debouncedTime, maxEndDateTime]);

  // 2.5. 載入過去 24 小時的熱區列表
  useEffect(() => {
    const fetch24hClusters = async () => {
      try {
        const res = await fetch(
          `/api/clusters-24h?time=${encodeURIComponent(debouncedTime)}` +
            `&radius=${systemSettings.cluster_radius_km}` +
            `&min_stations=${systemSettings.min_cluster_stations}` +
            `&pm25_threshold=${systemSettings.pm25_threshold}` +
            `&consecutive_exceeds=${systemSettings.consecutive_exceeds}`
        );
        const data = await res.json();
        if (Array.isArray(data)) {
          setClusters24h(data);
        }
      } catch (err) {
        console.error('載入24小時熱區失敗:', err);
      }
    };

    fetch24hClusters();
  }, [debouncedTime, systemSettings]);

  // 2.7. 當時間改變時，載入感測器資料完整率（1h）
  useEffect(() => {
    const fetchCompleteness = async () => {
      try {
        const res = await fetch(`/api/completeness?time=${encodeURIComponent(debouncedTime)}`);
        const data = await res.json();
        setCompleteness(data);
      } catch (e) {
        console.error('載入完整率失敗:', e);
      }
    };

    fetchCompleteness();
  }, [debouncedTime]);

  // 3. 當選取的感測站改變時，載入該站在日期區間內的歷史趨勢
  useEffect(() => {
    if (!selectedSensorId) {
      prevSensorIdRef.current = null;
      return;
    }

    // 在播放狀態中不重複抓取歷史，避免視覺反覆載入閃爍與效能耗損
    if (isPlaying) return;

    // 只有在更換感測器時，才清空歷史數據以顯示加載狀態；
    // 如果只是時間微幅改變，則不先清空，而是背景靜默載入，避免視覺上反覆出現空白閃爍。
    if (prevSensorIdRef.current !== selectedSensorId) {
      setHistoryData([]);
      prevSensorIdRef.current = selectedSensorId;
    }

    const sensor = points.find((p) => p.id === selectedSensorId);
    if (sensor) {
      setSelectedSensor({
        id: sensor.id,
        name: sensor.name,
        lat: sensor.lat,
        lon: sensor.lon,
        county: sensor.county,
        status: sensor.status
      });
    }

    const fetchHistory = async () => {
      const cacheKey = `${selectedSensorId}_${debouncedTime}`;
      if (historyCacheRef.current[cacheKey]) {
        setHistoryData(historyCacheRef.current[cacheKey]);
        return;
      }

      setIsLoadingHistory(true);
      try {
        // 以 debouncedTime 為基準，往回 7 天的歷史觀測
        const endDt = new Date(debouncedTime.replace(/-/g, '/'));
        const startDt = new Date(endDt.getTime() - 7 * 24 * 60 * 60 * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
        const queryStart = fmt(startDt);
        const queryEnd = fmt(endDt);
        const res = await fetch(
          `/api/observations?sensorId=${selectedSensorId}&startTime=${encodeURIComponent(
            queryStart
          )}&endTime=${encodeURIComponent(queryEnd)}&limit=1000`
        );
        const data = await res.json();
        historyCacheRef.current[cacheKey] = data;
        setHistoryData(data);
      } catch (e) {
        console.error('載入歷史數據失敗:', e);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [selectedSensorId, debouncedTime, isPlaying]);

  // 4. 事件管理 API 寫入/更新/刪除操作

  const handleAddEvent = async (eventData: any) => {
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
      });
      if (res.ok) {
        fetchEvents();
      }
    } catch (e) {
      console.error('新增事件失敗:', e);
    }
  };

  const handleUpdateEvent = async (eventId: string, eventData: any) => {
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
      });
      if (res.ok) {
        fetchEvents();
      }
    } catch (e) {
      console.error('更新事件失敗:', e);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('確認要刪除此事件嗎？')) return;
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchEvents();
      }
    } catch (e) {
      console.error('刪除事件失敗:', e);
    }
  };

  const handleClusterChange = (clusterId: string | null) => {
    setSelectedClusterId(clusterId);
    if (clusterId) {
      const found = clusters24h.find((c) => c.id === clusterId);
      if (found) {
        let timeStr = found.time;
        if (timeStr.includes('T') || timeStr.includes('Z')) {
          const d = new Date(timeStr);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const seconds = String(d.getSeconds()).padStart(2, '0');
          timeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        }
        setCurrentDateTime(timeStr);
      }
    }
  };

  // 4.5. 儲存判定門檻設定並重新載入點位
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pm25Input, setPm25Input] = useState<string>('54');
  const [consecutiveInput, setConsecutiveInput] = useState<string>('3');
  const [radiusInput, setRadiusInput] = useState<string>('1.0');
  const [minStationsInput, setMinStationsInput] = useState<string>('2');

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const pm25Val = parseFloat(pm25Input);
    const consecutiveVal = parseInt(consecutiveInput, 10);
    const radiusVal = parseFloat(radiusInput);
    const minStationsVal = parseInt(minStationsInput, 10);

    if (isNaN(pm25Val) || isNaN(consecutiveVal) || isNaN(radiusVal) || isNaN(minStationsVal)) {
      alert('請輸入有效的數值');
      return;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pm25_threshold: pm25Val,
          consecutive_exceeds: consecutiveVal,
          cluster_radius_km: radiusVal,
          min_cluster_stations: minStationsVal
        })
      });
      if (res.ok) {
        setSystemSettings({
          pm25_threshold: pm25Val,
          consecutive_exceeds: consecutiveVal,
          cluster_radius_km: radiusVal,
          min_cluster_stations: minStationsVal
        });

        if (typeof window !== 'undefined') {
          localStorage.setItem('pm25_threshold', pm25Val.toString());
          localStorage.setItem('consecutive_exceeds', consecutiveVal.toString());
          localStorage.setItem('cluster_radius_km', radiusVal.toString());
          localStorage.setItem('min_cluster_stations', minStationsVal.toString());
        }

        setShowSettingsModal(false);
        // 強制刷新當前點位資料
        const refreshRes = await fetch(
          `/api/anomalies?time=${encodeURIComponent(currentTime)}` +
            `&radius=${radiusVal}` +
            `&min_stations=${minStationsVal}` +
            `&pm25_threshold=${pm25Val}` +
            `&consecutive_exceeds=${consecutiveVal}`
        );
        const refreshData = await refreshRes.json();
        if (refreshData.points) setPoints(refreshData.points);
        if (refreshData.clusters) setClusters(refreshData.clusters);
      }
    } catch (err) {
      console.error('儲存設定失敗:', err);
    }
  };

  useEffect(() => {
    // 當系統設定加載完成後更新輸入欄位狀態
    if (systemSettings) {
      setPm25Input(systemSettings.pm25_threshold?.toString() ?? '54');
      setConsecutiveInput(systemSettings.consecutive_exceeds?.toString() ?? '3');
      setRadiusInput(systemSettings.cluster_radius_km?.toString() ?? '1.0');
      setMinStationsInput(systemSettings.min_cluster_stations?.toString() ?? '2');
    }
  }, [systemSettings]);

  // 5. 歷史時間軸播放控制（播放時從開始時間往結束時間順向播放，每步 +5 分鐘，播放到結束時間停止）
  const handlePlayToggle = () => {
    if (isPlaying) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      
      const minTs = new Date(startDateTime.replace('T', ' ')).getTime();
      const maxTs = new Date(endDateTime.replace('T', ' ')).getTime();
      
      // 若當前已經是結束時間，重新開始播放時跳回開始時間
      let startTs = new Date(currentDateTime.replace('T', ' ')).getTime();
      if (startTs >= maxTs) {
        startTs = minTs;
        setCurrentDateTime(startDateTime);
      }

      playIntervalRef.current = setInterval(() => {
        setCurrentDateTime((prev) => {
          const prevTs = new Date(prev.replace('T', ' ')).getTime();
          const speedMultiplier = playSpeedRef.current;
          const nextTs = prevTs + 5 * speedMultiplier * 60 * 1000;
          if (nextTs >= maxTs) {
            if (playIntervalRef.current) clearInterval(playIntervalRef.current);
            setIsPlaying(false);
            return endDateTime;
          }
          const nextDate = new Date(nextTs);
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${nextDate.getFullYear()}-${pad(nextDate.getMonth()+1)}-${pad(nextDate.getDate())}T${pad(nextDate.getHours())}:${pad(nextDate.getMinutes())}`;
        });
      }, 1000);
    }
  };

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, []);

  // 覆蓋/補齊歷史事件當下的觀測值
  const displayPoints = React.useMemo(() => {
    if (!activeEventId) return points;
    const event = events.find(e => e.id === activeEventId);
    if (!event || !event.sensors) return points;

    const updatedPoints = [...points];
    for (const es of event.sensors) {
      const idx = updatedPoints.findIndex(p => p.id === es.id);
      const formattedSensorObs = {
        id: es.id,
        name: es.name,
        lat: es.lat,
        lon: es.lon,
        county: es.county,
        status: es.status,
        sensor_id: es.id,
        time: event.event_time || '',
        pm2_5: es.pm2_5,
        temperature: es.temperature,
        humidity: es.humidity,
        voc: es.voc,
        isAnomaly: es.pm2_5 !== null && es.pm2_5 >= systemSettings.pm25_threshold,
        anomalyType: (es.pm2_5 !== null && es.pm2_5 >= systemSettings.pm25_threshold) ? 'PM₂.₅ 超標' : '',
        score: (es.pm2_5 || 0) * 0.5
      };

      if (idx !== -1) {
        updatedPoints[idx] = { ...updatedPoints[idx], ...formattedSensorObs };
      } else {
        updatedPoints.push(formattedSensorObs as any);
      }
    }
    return updatedPoints;
  }, [points, activeEventId, events, systemSettings]);

  // 篩選後要渲染在地圖上的點位
  const filteredPoints = displayPoints.filter((pt) => {
    if (selectedFilter.type === 'county' && pt.county !== selectedFilter.value) return false;
    if (selectedFilter.type === 'zone' && sensorZoneMap[pt.id] !== selectedFilter.value) return false;
    if (selectedDeviceId !== 'all' && pt.id !== selectedDeviceId) return false;
    
    const val = pt[selectedMetric];
    if (val === null || val === undefined) return false;
    if (val < minVal || val > maxVal) return false;

    return true;
  });

  // 取得符合第一層篩選的所有設備清單，供第二層 DeviceID 下拉選單選擇
  const availableDevices = displayPoints.filter((pt) => {
    if (selectedFilter.type === 'county' && pt.county !== selectedFilter.value) return false;
    if (selectedFilter.type === 'zone' && sensorZoneMap[pt.id] !== selectedFilter.value) return false;
    return true;
  });

  const minTs = isMounted ? new Date(startDateTime.replace('T', ' ')).getTime() : 0;
  const maxTs = isMounted ? new Date(endDateTime.replace('T', ' ')).getTime() : 0;
  const curTs = isMounted ? new Date(currentDateTime.replace('T', ' ')).getTime() : 0;
  const sliderPercent = maxTs === minTs ? 0 : ((curTs - minTs) / (maxTs - minTs)) * 100;
  const isSameDay = isMounted ? new Date(startDateTime.replace('T', ' ')).toDateString() === new Date(endDateTime.replace('T', ' ')).toDateString() : true;

  return (
    <div className="flex flex-col h-auto lg:h-screen w-full text-slate-100 overflow-y-auto lg:overflow-hidden font-sans" style={{background: 'var(--background)'}}>
      
      {/* 頂部導航與狀態看板 */}
      <header className="tech-grid min-h-[60px] lg:h-[65px] border-b border-slate-800/60 flex items-center justify-between px-4 lg:px-6 py-2 lg:py-0 z-20" style={{background: 'rgba(8,12,20,0.92)', backdropFilter: 'blur(20px)'}}>
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="bg-orange-500 text-slate-950 p-1.5 lg:p-2 rounded-xl flex items-center justify-center font-black text-xs lg:text-sm tracking-wider shadow-lg shadow-orange-500/20">
            GIS
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-extrabold tracking-wide text-slate-200">微感監測中心</h1>
            <span className="text-[10px] text-slate-500 font-medium">相關數據節錄於環境物聯網感測數據，僅功能測試使用。</span>
          </div>
        </div>

        {/* 系統即時摘要 */}
        <div className="hidden lg:flex items-center gap-6 text-xs border-l border-slate-800 pl-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-semibold mb-0.5">微感總數</span>
            <span className="font-bold text-slate-300 text-sm">
              {points.length} 站
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-semibold mb-0.5">異常微感數</span>
            <span className="font-bold text-red-400 flex items-center gap-1.5 text-sm">
              {points.filter((p) => p.isAnomaly).length} 站
              <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" />
            </span>
          </div>
          {/* 完整率卡片 */}
          <div className="flex flex-col border-l border-slate-800 pl-6">
            <span className="text-[10px] text-slate-500 font-semibold mb-0.5">資料完整率（1h）</span>
            {completeness ? (
              completeness.mode === 'mock' ? (
                <span className="font-bold text-slate-500 text-sm">— 未連線</span>
              ) : (
                <span
                  className={`font-bold text-sm ${
                    (completeness.rate ?? 0) >= 90
                      ? 'text-emerald-400'
                      : (completeness.rate ?? 0) >= 70
                      ? 'text-yellow-400'
                      : 'text-red-400'
                  }`}
                >
                  {completeness.rate?.toFixed(1) ?? '--'}%
                  <span className="text-slate-500 font-normal text-xs ml-1">
                    （離線 {completeness.offline_count} 站）
                  </span>
                </span>
              )
            ) : (
              <span className="font-bold text-slate-600 text-sm animate-pulse">計算中...</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentUser && (
            <div className="text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-1.5 flex items-center gap-1.5 font-mono select-none">
              <span className="text-slate-300 font-semibold">👤 {currentUser.username}</span>
              <span className={`text-[9px] font-black px-1.5 py-0.2 rounded border uppercase ${
                currentUser.role === 'admin'
                  ? 'bg-red-500/20 text-red-400 border-red-500/40 ring-1 ring-red-500/20'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                {currentUser.role}
              </span>
            </div>
          )}

          <div className="text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-1.5 flex items-center gap-2">
            <span className="text-slate-500 font-medium">更新狀態:</span>
            <span className="text-emerald-400 flex items-center gap-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              連線正常
            </span>
          </div>
          <button
            onClick={() => {
              if (systemSettings) {
                setPm25Input(systemSettings.pm25_threshold?.toString() ?? '54');
                setConsecutiveInput(systemSettings.consecutive_exceeds?.toString() ?? '3');
                setRadiusInput(systemSettings.cluster_radius_km?.toString() ?? '1.0');
                setMinStationsInput(systemSettings.min_cluster_stations?.toString() ?? '2');
              }
              setShowSettingsModal(true);
            }}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white p-2 lg:px-4 lg:py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
            title="事件門檻設定"
          >
            <Settings className="w-4 h-4 text-orange-500" />
            <span className="hidden sm:inline">事件門檻設定</span>
          </button>
        </div>
      </header>

      {/* 主儀表板區域 (三欄式 / RWD 佈局) */}
      <main className="flex-1 flex flex-col lg:flex-row p-3 lg:p-4 gap-3 lg:gap-4 h-auto lg:h-[calc(100vh-65px)] overflow-y-auto lg:overflow-hidden">
        
        {/* 行動端篩選摺疊切換按鈕 */}
        <div className="lg:hidden flex items-center justify-between bg-slate-900 border border-slate-850 rounded-2xl p-3 shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <span className="text-xs font-bold text-slate-300">時間與地區篩選</span>
          </div>
          <button
            type="button"
            onClick={() => setShowFiltersMobile(!showFiltersMobile)}
            className="bg-orange-500 hover:bg-orange-600 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
          >
            {showFiltersMobile ? '收合篩選器' : '展開篩選器'}
          </button>
        </div>

        {/* 左側欄: 篩選條件 */}
        <section className={`${showFiltersMobile ? 'block' : 'hidden'} lg:block w-full lg:w-[20%] lg:min-w-[240px] lg:max-w-[280px] h-auto lg:h-full flex flex-col gap-4`}>
          <FilterPanel
            counties={counties}
            zoneNames={zoneNames}
            selectedFilter={selectedFilter}
            onChangeFilter={(f) => {
              setSelectedFilter(f);
              setSelectedDeviceId('all');
            }}
            availableDevices={availableDevices}
            selectedDeviceId={selectedDeviceId}
            onChangeDeviceId={setSelectedDeviceId}
            startDateTime={startDateTime}
            onChangeStartDateTime={(val) => {
              const alignedVal = alignTo5Minutes(val);
              setStartDateTime(alignedVal);
              const curTs = new Date(currentDateTime.replace('T', ' ')).getTime();
              const newMinTs = new Date(alignedVal.replace('T', ' ')).getTime();
              if (curTs < newMinTs) {
                setCurrentDateTime(alignedVal);
              }
            }}
            endDateTime={endDateTime}
            onChangeEndDateTime={(val) => {
              const alignedVal = alignTo5Minutes(val);
              setEndDateTime(alignedVal);
              const curTs = new Date(currentDateTime.replace('T', ' ')).getTime();
              const newMaxTs = new Date(alignedVal.replace('T', ' ')).getTime();
              if (curTs > newMaxTs) {
                setCurrentDateTime(alignedVal);
              }
            }}
            maxEndDateTime={maxEndDateTime}
            selectedMetric={selectedMetric}
            onChangeMetric={setSelectedMetric}
            minVal={minVal}
            maxVal={maxVal}
            onChangeMinVal={setMinVal}
            onChangeMaxVal={setMaxVal}
            isLoading={isLoadingPoints}
            highPollutionDevices={points.filter((p) => p.isAnomaly || (p.pm2_5 !== null && p.pm2_5 > systemSettings.pm25_threshold))}
            selectedHighPollutionDeviceId={selectedSensorId}
            onChangeHighPollutionDeviceId={setSelectedSensorId}
          />
        </section>

        {/* 中間欄: 地圖與時間軸播放器 */}
        <section className="w-full lg:flex-1 h-[450px] md:h-[500px] lg:h-full flex flex-col gap-3 lg:gap-4">
          {/* 地圖區域 */}
          <div className="flex-1 relative min-h-[300px]">
            {activeEventId && showHistoryBanner && (
              <div className="absolute top-16 left-4 right-4 lg:right-28 bg-orange-900/80 border border-orange-500/40 text-orange-200 px-4 py-2.5 rounded-2xl flex items-center justify-between text-xs z-[1000] backdrop-blur-md shadow-lg shadow-orange-500/10 animate-fade-in gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldAlert className="w-4 h-4 text-orange-500 shrink-0 animate-pulse" />
                  <span className="truncate">
                    正在檢視歷史事件：<strong>{events.find(e => e.id === activeEventId)?.title}</strong> 
                    （事件時間：{events.find(e => e.id === activeEventId)?.event_time}）
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setActiveEventId(null);
                      setShowHistoryBanner(false);
                    }}
                    className="bg-orange-500 hover:bg-orange-600 text-slate-950 px-2.5 py-1 rounded-xl font-bold cursor-pointer transition-colors shadow-md shadow-orange-500/10 active:scale-95 shrink-0 font-sans"
                  >
                    返回即時監測
                  </button>
                  <button
                    onClick={() => {
                      setShowHistoryBanner(false);
                    }}
                    className="text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 p-1.5 rounded-xl cursor-pointer transition-colors active:scale-90"
                    title="關閉通知"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            <SensorMap
              points={filteredPoints}
              clusters={clusters}
              selectedSensorId={selectedSensorId}
              onSelectSensor={setSelectedSensorId}
              onMapClickCoords={(coords) => {
                console.log('Map clicked coordinates:', coords);
              }}
              selectedClusterId={selectedClusterId}
              selectedFilter={selectedFilter}
              regionCenters={regionCenters}
              selectedMetric={selectedMetric}
              activeEvent={events.find(e => e.id === activeEventId)}
              pm25Threshold={systemSettings.pm25_threshold}
              dispersionEvent={dispersionEvent}
              onClearDispersion={() => setDispersionEvent(null)}
            />
          </div>

          {/* 歷史時間軸播放器 */}
          <div className="glass-card rounded-2xl px-4 pt-3 pb-4 shadow-lg flex flex-col gap-2">
            {/* 上排：播放控制 + 當前時間 */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePlayToggle}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-md cursor-pointer shrink-0 ${
                  isPlaying
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-orange-500 hover:bg-orange-600 text-slate-950'
                }`}
                title={isPlaying ? '暫停' : '開始播放'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>

              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 font-bold">歷史回溯 (5分鐘級)</span>
                <span className="text-xs font-semibold text-slate-300">
                  {isPlaying ? '回溯中（每步 5 分鐘）' : curTs === maxTs ? '最新時間' : '已暫停'}
                </span>
              </div>

              {/* 播放速度控制按鈕 */}
              <div className="flex items-center bg-slate-950/80 border border-slate-800/80 rounded-xl p-0.5 gap-0.5 ml-2">
                {([1, 2, 4] as const).map((speed) => (
                  <button
                    key={speed}
                    onClick={() => setPlaySpeed(speed)}
                    className={`px-2 py-1 rounded-lg text-[9px] font-black tracking-wider transition-all cursor-pointer ${
                      playSpeed === speed
                        ? 'bg-orange-500 text-slate-950 font-black'
                        : 'text-slate-500 hover:text-slate-350'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* 當前時間標籤 */}
                <span className="text-orange-400 font-bold text-sm bg-slate-950 border border-slate-800 px-3 py-1 rounded-full tabular-nums">
                  {(() => {
                    if (!isMounted) return '';
                    const d = new Date(currentDateTime.replace('T', ' '));
                    const pad = (n: number) => String(n).padStart(2, '0');
                    return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                  })()}
                </span>
                {/* 回到最新時間 */}
                <button
                  onClick={() => { setCurrentDateTime(endDateTime); setIsPlaying(false); }}
                  className="p-1.5 bg-slate-950 hover:bg-slate-800 rounded-xl border border-slate-800 text-slate-400 hover:text-orange-400 transition-colors cursor-pointer"
                  title="回到最新時間"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Slider */}
            <div className="relative w-full flex flex-col gap-1">
              <input
                type="range"
                min={minTs}
                max={maxTs}
                step={5 * 60 * 1000}
                value={curTs}
                onChange={(e) => {
                  const ts = Number(e.target.value);
                  const d = new Date(ts);
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const dtStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                  setCurrentDateTime(dtStr);
                  setIsPlaying(false);
                }}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #f97316 ${sliderPercent}%, #0f172a ${sliderPercent}%)`,
                  accentColor: '#f97316',
                }}
              />
              {/* 刻度標記：均勻劃分 6 個刻度 */}
              <div className="flex justify-between text-[9px] text-slate-600 font-mono px-0.5 select-none">
                {isMounted && Array.from({ length: 6 }, (_, i) => {
                  const tickTs = minTs + (maxTs - minTs) * (i / 5);
                  const d = new Date(tickTs);
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                  const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
                  const label = isSameDay ? timeStr : `${dateStr} ${timeStr}`;
                  const isCurrent = Math.abs(tickTs - curTs) < 150000; // 差距小於 2.5 分鐘視為當前刻度
                  return (
                    <span key={i} className={isCurrent ? 'text-orange-400 font-bold' : ''}>
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 右側欄: 事件清單 & 詳細趨勢圖 */}
        <section className="w-full lg:w-[27%] lg:min-w-[320px] lg:max-w-[380px] h-auto lg:h-full flex flex-col md:flex-row lg:flex-col gap-3 lg:gap-4 lg:overflow-hidden">
          {/* 上半部: 事件管理列表 */}
          <div className="w-full md:w-1/2 lg:w-full h-[350px] md:h-[400px] lg:h-auto lg:flex-[2] lg:min-h-0 lg:overflow-hidden">
            <EventManager
              selectedSensor={selectedSensor}
              onSelectSensor={setSelectedSensorId}
              events={events}
              onAddEvent={handleAddEvent}
              onUpdateEvent={handleUpdateEvent}
              onDeleteEvent={handleDeleteEvent}
              isLoading={isLoadingPoints}
              activeEventId={activeEventId}
              isAdmin={currentUser?.role === 'admin'}
              onViewEvent={(event) => {
                if (event) {
                  setActiveEventId(event.id);
                  setShowHistoryBanner(true);
                  if (event.event_time) {
                    const newTime = event.event_time.replace(' ', 'T').substring(0, 16);
                    setCurrentDateTime(newTime);
                  }
                  if (event.sensors && event.sensors.length > 0) {
                    setSelectedSensorId(event.sensors[0].id);
                  }
                } else {
                  setActiveEventId(null);
                  setShowHistoryBanner(false);
                }
              }}
              currentDateTime={currentDateTime}
              systemSettings={systemSettings}
              points={allSensors}
              sensorZoneMap={sensorZoneMap}
              onSimulateDispersion={(event) => {
                setDispersionEvent(prev => prev?.id === event.id ? null : event);
              }}
              dispersionEventId={dispersionEvent?.id ?? null}
            />
          </div>

          {/* 下半部: 被選定測站趨勢圖 */}
          <div className="w-full md:w-1/2 lg:w-full h-[450px] lg:flex-[3] lg:min-h-0 lg:overflow-hidden">
            <TrendChart
              selectedSensor={selectedSensor}
              historyData={historyData}
              pm25Threshold={systemSettings.pm25_threshold}
            />
          </div>
        </section>

      </main>

      {/* 設定 Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{background: 'rgba(4,8,16,0.85)', backdropFilter: 'blur(12px)'}}>
          <div className="glass-card neon-border rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-5">
            <div className="flex justify-between items-center border-b border-slate-850 pb-3">
              <h3 className="font-bold text-slate-100 flex items-center gap-1.5">
                <Settings className="w-5 h-5 text-orange-500" />
                事件門檻設定
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-500 hover:text-slate-350"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">PM₂.₅ 異常門檻值 (ug/m³)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={pm25Input}
                  onChange={(e) => setPm25Input(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500">標準：高於此數值視為空氣品質異常點。</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">連續超標判定筆數 (5分鐘一筆)</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  required
                  value={consecutiveInput}
                  onChange={(e) => setConsecutiveInput(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500">標準：測站需要連續多少筆資料都高於 PM₂.₅ 異常門檻值，才判定為異常點。</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">空間聚集半徑 (km)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={radiusInput}
                    onChange={(e) => setRadiusInput(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">最少聚集群聚站數</label>
                  <input
                    type="number"
                    required
                    value={minStationsInput}
                    onChange={(e) => setMinStationsInput(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
              <span className="text-[10px] text-slate-500 -mt-2">
                說明：在此半徑內若有大於此站數的超標感測器，即會在地圖上渲染出一個紅色「空間異常熱區」。
              </span>

              <div className="text-[11px] text-orange-500/90 font-medium mt-1">
                * 備註：判定規則調整後僅對未來即時資料生效，不可回溯歷史資料。
              </div>

              <button
                type="submit"
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors mt-2 cursor-pointer"
              >
                套用設定並重新計算
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

