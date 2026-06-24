'use client';

import React, { useState, useEffect, useRef } from 'react';
import FilterPanel from '@/components/Sidebar/FilterPanel';
import SensorMap from '@/components/Map/SensorMap';
import EventManager from '@/components/EventList/EventManager';
import TrendChart from '@/components/Analytics/TrendChart';
import { Sensor, Observation, Event, Cluster, SystemSettings } from '@/types';
import { Play, Pause, RotateCcw, ShieldAlert, Radio, Settings, X } from 'lucide-react';

export default function DashboardPage() {
  // 篩選與播放狀態
  const [selectedCounty, setSelectedCounty] = useState('');
  const [selectedDate, setSelectedDate] = useState('2026-04-02'); // 預設 2026-04-02 有較多異常
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('10:10:00');
  const [selectedMetric, setSelectedMetric] = useState<'pm2_5' | 'temperature' | 'humidity' | 'voc'>('pm2_5');
  const [minVal, setMinVal] = useState(0);
  const [maxVal, setMaxVal] = useState(300);

  // 資料狀態
  const [points, setPoints] = useState<(Sensor & Observation)[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [historyData, setHistoryData] = useState<Observation[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    pm25_threshold: 54,
    temp_increase_threshold: 3,
    voc_threshold: 1.5,
    cluster_radius_km: 1.0,
    min_cluster_stations: 2
  });

  // UI 狀態
  const [isLoadingPoints, setIsLoadingPoints] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 1. 初始化行政區列表與系統設定
  useEffect(() => {
    const initData = async () => {
      try {
        // 取得所有感測器以提取行政區列表
        const res = await fetch('/api/sensors');
        const data: Sensor[] = await res.json();
        const extractedCounties = Array.from(new Set(data.map((s) => s.county))).filter(Boolean);
        setCounties(extractedCounties);

        // 取得系統閾值設定
        const settingsRes = await fetch('/api/settings');
        const settingsData = await settingsRes.json();
        if (settingsData && settingsData.pm25_threshold) {
          setSystemSettings({
            pm25_threshold: parseFloat(settingsData.pm25_threshold),
            temp_increase_threshold: parseFloat(settingsData.temp_increase_threshold),
            voc_threshold: parseFloat(settingsData.voc_threshold),
            cluster_radius_km: parseFloat(settingsData.cluster_radius_km),
            min_cluster_stations: parseInt(settingsData.min_cluster_stations, 10)
          });
        }
      } catch (e) {
        console.error('初始化失敗:', e);
      }
    };

    initData();
    fetchEvents();
  }, []);

  // 2. 當時間/日期改變時，載入感測點觀測值與異常聚類
  useEffect(() => {
    const fetchPoints = async () => {
      setIsLoadingPoints(true);
      try {
        const timeStr = `${selectedDate} ${selectedTimeSlot}`;
        const res = await fetch(`/api/anomalies?time=${encodeURIComponent(timeStr)}`);
        const data = await res.json();
        
        if (data.points) {
          setPoints(data.points);
        }
        if (data.clusters) {
          setClusters(data.clusters);
        }
      } catch (e) {
        console.error('載入點位失敗:', e);
      } finally {
        setIsLoadingPoints(false);
      }
    };

    fetchPoints();
  }, [selectedDate, selectedTimeSlot]);

  // 3. 當選取的感測站改變時，載入該站當天的 24 小時歷史趨勢
  useEffect(() => {
    if (!selectedSensorId) return;

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
      setIsLoadingHistory(true);
      try {
        const startTime = `${selectedDate} 00:00:00`;
        const endTime = `${selectedDate} 23:55:00`;
        const res = await fetch(
          `/api/observations?sensorId=${selectedSensorId}&startTime=${encodeURIComponent(
            startTime
          )}&endTime=${encodeURIComponent(endTime)}&limit=300`
        );
        const data = await res.json();
        setHistoryData(data);
      } catch (e) {
        console.error('載入歷史數據失敗:', e);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [selectedSensorId, selectedDate]);

  // 4. 事件管理 API 串接
  const fetchEvents = async () => {
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      setEvents(data);
    } catch (e) {
      console.error('載入事件失敗:', e);
    }
  };

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

  // 4.5. 儲存判定門檻設定並重新載入點位
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [pm25Input, setPm25Input] = useState(54);
  const [tempInput, setTempInput] = useState(3);
  const [vocInput, setVocInput] = useState(1.5);
  const [radiusInput, setRadiusInput] = useState(1.0);
  const [minStationsInput, setMinStationsInput] = useState(2);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pm25_threshold: pm25Input,
          temp_increase_threshold: tempInput,
          voc_threshold: vocInput,
          cluster_radius_km: radiusInput,
          min_cluster_stations: minStationsInput
        })
      });
      if (res.ok) {
        setSystemSettings({
          pm25_threshold: pm25Input,
          temp_increase_threshold: tempInput,
          voc_threshold: vocInput,
          cluster_radius_km: radiusInput,
          min_cluster_stations: minStationsInput
        });
        setShowSettingsModal(false);
        // 強制刷新當前點位資料
        const timeStr = `${selectedDate} ${selectedTimeSlot}`;
        const refreshRes = await fetch(`/api/anomalies?time=${encodeURIComponent(timeStr)}`);
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
    setPm25Input(systemSettings.pm25_threshold);
    setTempInput(systemSettings.temp_increase_threshold);
    setVocInput(systemSettings.voc_threshold);
    setRadiusInput(systemSettings.cluster_radius_km);
    setMinStationsInput(systemSettings.min_cluster_stations);
  }, [systemSettings]);

  // 5. 播放時間軸控制邏輯
  const handlePlayToggle = () => {
    if (isPlaying) {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      playIntervalRef.current = setInterval(() => {
        setSelectedTimeSlot((prevTime) => {
          const parts = prevTime.split(':');
          let h = parseInt(parts[0], 10);
          let m = parseInt(parts[1], 10);
          
          m += 5;
          if (m >= 60) {
            m = 0;
            h += 1;
          }
          if (h >= 24) {
            h = 0;
            setSelectedDate((prevDate) => {
              const day = parseInt(prevDate.substring(8, 10), 10);
              const nextDay = day >= 30 ? 1 : day + 1;
              return `2026-04-${String(nextDay).padStart(2, '0')}`;
            });
          }
          
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
        });
      }, 1800);
    }
  };

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, []);

  // 篩選後要渲染在地圖上的點位
  const filteredPoints = points.filter((pt) => {
    if (selectedCounty && pt.county !== selectedCounty) return false;
    
    const val = pt[selectedMetric];
    if (val === null || val === undefined) return false;
    if (val < minVal || val > maxVal) return false;

    return true;
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0b0f19] text-slate-100 overflow-hidden font-sans">
      
      {/* 頂部導航與狀態看板 */}
      <header className="h-[65px] bg-[#121824]/90 border-b border-slate-800 flex items-center justify-between px-6 z-20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 text-slate-950 p-2 rounded-xl flex items-center justify-center font-black text-sm tracking-wider shadow-lg shadow-orange-500/20">
            GIS
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-extrabold tracking-wide text-slate-200">微感 GIS 空氣品質分析儀表板</h1>
            <span className="text-[10px] text-slate-500 font-medium">環境部環境物聯網微感測數據中心</span>
          </div>
        </div>

        {/* 系統即時摘要 */}
        <div className="hidden lg:flex items-center gap-6 text-xs border-l border-slate-800 pl-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-semibold mb-0.5">時間點異常感測站數</span>
            <span className="font-bold text-red-400 flex items-center gap-1.5 text-sm">
              {points.filter((p) => p.isAnomaly).length} 站
              <ShieldAlert className="w-4 h-4 text-red-500 animate-pulse" />
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-semibold mb-0.5">空間疑似燃燒熱區</span>
            <span className="font-bold text-orange-400 flex items-center gap-1.5 text-sm">
              {clusters.length} 處
              <Radio className="w-4 h-4 text-orange-500 animate-pulse" />
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-semibold mb-0.5">當前系統判定閾值</span>
            <span className="font-bold text-slate-400 text-sm">
              PM2.5 &gt; {systemSettings.pm25_threshold} ug/m³
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Settings className="w-4 h-4 text-orange-500" />
            判定參數與回測設定
          </button>
        </div>
      </header>

      {/* 主儀表板區域 (三欄式佈局) */}
      <main className="flex-1 flex overflow-hidden p-4 gap-4">
        
        {/* 左側欄: 篩選條件 (20%) */}
        <section className="w-[20%] min-w-[240px] max-w-[280px] h-full flex flex-col gap-4">
          <FilterPanel
            counties={counties}
            selectedCounty={selectedCounty}
            onChangeCounty={setSelectedCounty}
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            selectedTimeSlot={selectedTimeSlot}
            onChangeTimeSlot={setSelectedTimeSlot}
            selectedMetric={selectedMetric}
            onChangeMetric={setSelectedMetric}
            minVal={minVal}
            maxVal={maxVal}
            onChangeMinVal={setMinVal}
            onChangeMaxVal={setMaxVal}
            isLoading={isLoadingPoints}
          />
        </section>

        {/* 中間欄: 地圖與時間軸播放器 (53%) */}
        <section className="flex-1 h-full flex flex-col gap-4">
          {/* 地圖區域 */}
          <div className="flex-1 relative">
            <SensorMap
              points={filteredPoints}
              clusters={clusters}
              selectedSensorId={selectedSensorId}
              onSelectSensor={setSelectedSensorId}
              onMapClickCoords={(coords) => {
                console.log('Map clicked coordinates:', coords);
              }}
            />
          </div>

          {/* 時間軸播放器 */}
          <div className="h-[75px] bg-[#121824] border border-slate-800 rounded-2xl px-5 py-3 flex items-center justify-between shadow-lg gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={handlePlayToggle}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-md cursor-pointer ${
                  isPlaying
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-orange-500 hover:bg-orange-600 text-slate-950'
                }`}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
              
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 font-bold">時間軸自動播控</span>
                <span className="text-xs font-semibold text-slate-300">
                  {isPlaying ? '播放中 (步長: 5分鐘)' : '已暫停'}
                </span>
              </div>
            </div>

            {/* 進度顯示與快速調整 */}
            <div className="flex-1 flex flex-col gap-1 max-w-[60%]">
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold px-1">
                <span>00:00</span>
                <span className="text-orange-400 font-bold text-xs bg-slate-950 border border-slate-800 px-2.5 py-0.5 rounded-full">
                  {selectedDate} &nbsp; {selectedTimeSlot.substring(0, 5)}
                </span>
                <span>23:55</span>
              </div>
              
              {/* 進度條 */}
              <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                <div
                  className="bg-orange-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      ((parseInt(selectedTimeSlot.split(':')[0], 10) * 60 +
                        parseInt(selectedTimeSlot.split(':')[1], 10)) /
                        1440) *
                      100
                    }%`
                  }}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedTimeSlot('00:00:00');
                  setIsPlaying(false);
                }}
                className="p-2 bg-slate-950 hover:bg-slate-850 rounded-xl border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="重設當天時間"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* 右側欄: 事件清單 & 詳細趨勢圖 (27%) */}
        <section className="w-[27%] min-w-[320px] max-w-[380px] h-full flex flex-col gap-4">
          {/* 上半部: 事件管理列表 */}
          <div className="flex-1 min-h-[300px]">
            <EventManager
              selectedSensor={selectedSensor}
              onSelectSensor={setSelectedSensorId}
              events={events}
              onAddEvent={handleAddEvent}
              onUpdateEvent={handleUpdateEvent}
              onDeleteEvent={handleDeleteEvent}
              isLoading={isLoadingPoints}
            />
          </div>

          {/* 下半部: 被選定測站趨勢圖 */}
          <div className="h-[300px]">
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
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#121824] border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-5">
            <div className="flex justify-between items-center border-b border-slate-850 pb-3">
              <h3 className="font-bold text-slate-100 flex items-center gap-1.5">
                <Settings className="w-5 h-5 text-orange-500" />
                排污判定引數與回測設定
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
                <label className="text-xs text-slate-400 font-semibold">PM2.5 異常門檻值 (ug/m³)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={pm25Input}
                  onChange={(e) => setPm25Input(parseFloat(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500">標準：高於此數值視為空氣品質異常點。</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">溫度突升閾值 (°C / 15分鐘)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={tempInput}
                  onChange={(e) => setTempInput(parseFloat(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500">標準：短時間內溫度升溫超過此值，極可能為燃燒起火點。</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold">VOC (揮發性有機物) 異常值 (ppm)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={vocInput}
                  onChange={(e) => setVocInput(parseFloat(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-500">標準：用於區分工業工廠排污與一般垃圾燃燒。</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">空間聚集半徑 (km)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={radiusInput}
                    onChange={(e) => setRadiusInput(parseFloat(e.target.value))}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-semibold">最少聚集群聚站數</label>
                  <input
                    type="number"
                    required
                    value={minStationsInput}
                    onChange={(e) => setMinStationsInput(parseInt(e.target.value, 10))}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
              <span className="text-[10px] text-slate-500 -mt-2">
                說明：在此半徑內若有大於此站數的超標感測器，即會在地圖上渲染出一個紅色「空間異常熱區」。
              </span>

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

