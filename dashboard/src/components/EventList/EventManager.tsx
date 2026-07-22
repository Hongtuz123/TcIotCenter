'use client';

import React, { useState, useEffect } from 'react';
import { Event, Sensor } from '@/types';
import { AlertCircle, FileText, Trash2, X, PlusCircle, Link, Wind } from 'lucide-react';

interface EventManagerProps {
  selectedSensor: Sensor | null;
  onSelectSensor: (sensorId: string) => void;
  // 事件 API 操作
  events: Event[];
  onAddEvent: (eventData: Omit<Event, 'id' | 'created_at' | 'updated_at'> & { sensors: any[], event_time: string }) => Promise<void>;
  onUpdateEvent: (eventId: string, eventData: Partial<Event> & { sensors?: any[], event_time?: string }) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
  isLoading: boolean;

  // 新增 props
  activeEventId: string | null;
  onViewEvent: (event: Event | null) => void;
  currentDateTime: string;
  systemSettings?: any;
  points: any[];
  sensorZoneMap?: Record<string, string>;
  /** 污染擴散模擬相關 */
  onSimulateDispersion?: (event: Event) => void;
  dispersionEventId?: string | null;
  /** 管理者權限 */
  isAdmin?: boolean;
}

export const EventManager: React.FC<EventManagerProps> = ({
  selectedSensor,
  onSelectSensor,
  events,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  isLoading,
  activeEventId,
  onViewEvent,
  currentDateTime,
  systemSettings,
  points,
  sensorZoneMap,
  onSimulateDispersion,
  dispersionEventId,
  isAdmin = false
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const handleShpUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const fileName = file.name;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (!arrayBuffer) return;
        
        const view = new DataView(arrayBuffer);
        const fileCode = view.getInt32(0, false);
        if (fileCode !== 9994) {
          alert("無效的 Shapefile 檔案格式 (.shp)");
          return;
        }
        
        const pointsList: { x: number; y: number }[] = [];
        let offset = 100;
        const fileLengthBytes = view.getInt32(24, false) * 2;
        
        while (offset < fileLengthBytes) {
          if (offset + 8 > arrayBuffer.byteLength) break;
          const contentLengthBytes = view.getInt32(offset + 4, false) * 2;
          if (offset + 8 + contentLengthBytes > arrayBuffer.byteLength) break;
          
          const recordContentOffset = offset + 8;
          const shapeType = view.getInt32(recordContentOffset, true);
          
          if (shapeType === 5) { // Polygon
            const numParts = view.getInt32(recordContentOffset + 36, true);
            const numPoints = view.getInt32(recordContentOffset + 40, true);
            const partsOffset = recordContentOffset + 44;
            const pointsOffset = partsOffset + numParts * 4;
            
            for (let i = 0; i < numPoints; i++) {
              const ptOffset = pointsOffset + i * 16;
              if (ptOffset + 16 > arrayBuffer.byteLength) break;
              const x = view.getFloat64(ptOffset, true);
              const y = view.getFloat64(ptOffset + 8, true);
              pointsList.push({ x, y });
            }
          } else if (shapeType === 1) { // Point
            const x = view.getFloat64(recordContentOffset + 4, true);
            const y = view.getFloat64(recordContentOffset + 12, true);
            pointsList.push({ x, y });
          }
          
          offset += 8 + contentLengthBytes;
        }
        
        if (pointsList.length === 0) {
          alert("無法從 shp 檔案中解析出幾何點位，目前僅支援 Point (1) 或 Polygon (5) 類型。");
          return;
        }
        
        // 座標轉換為 WGS84
        const wgsPoints = pointsList.map((pt) => {
          if (pt.x > 1000) {
            return twd97ToWgs84(pt.x, pt.y);
          } else {
            return { lon: pt.x, lat: pt.y };
          }
        });
        
        // 計算中心點與半徑
        const sumLon = wgsPoints.reduce((sum, pt) => sum + pt.lon, 0);
        const sumLat = wgsPoints.reduce((sum, pt) => sum + pt.lat, 0);
        const centerLon = sumLon / wgsPoints.length;
        const centerLat = sumLat / wgsPoints.length;
        
        let maxDistKm = 0;
        for (const pt of wgsPoints) {
          const dist = getDistanceKm(centerLat, centerLon, pt.lat, pt.lon);
          if (dist > maxDistKm) maxDistKm = dist;
        }
        
        // 1. 尋找與 Shapefile 幾何中心 8.0 公里以內、且當時 PM2.5 最高的測站作為污染源頭；若無則取最近測站
        let sourceSensor: any = null;
        let maxPm25 = -1;
        let nearestSensor: any = null;
        let minDistance = Infinity;

        for (const s of points) {
          const dist = getDistanceKm(centerLat, centerLon, s.lat, s.lon);
          if (dist < minDistance) {
            minDistance = dist;
            nearestSensor = s;
          }
          if (dist <= 8.0) {
            const pmVal = (s as any).pm2_5 ?? 0;
            if (pmVal > maxPm25) {
              maxPm25 = pmVal;
              sourceSensor = s;
            }
          }
        }
        if (!sourceSensor) {
          sourceSensor = nearestSensor;
        }

        // 2. 將新的事件中心 bounds.center 設為污染源頭測站座標
        const finalCenterLat = sourceSensor ? sourceSensor.lat : centerLat;
        const finalCenterLon = sourceSensor ? sourceSensor.lon : centerLon;

        // 3. 計算污染源頭測站到多邊形所有頂點的最大距離，做為涵蓋半徑
        let maxDistFromSource = 0;
        for (const pt of wgsPoints) {
          const dist = getDistanceKm(finalCenterLat, finalCenterLon, pt.lat, pt.lon);
          if (dist > maxDistFromSource) maxDistFromSource = dist;
        }
        // 警示半徑：包覆多邊形，最低 1.5 公里，最高 6.0 公里
        const radiusKm = Math.max(1.5, Math.min(6.0, maxDistFromSource));

        // 4. 以污染源頭測站為圓心，以 radiusKm 為半徑，過濾並綁定 eventSensors
        let eventSensors: any[] = [];
        for (const s of points) {
          const dist = getDistanceKm(finalCenterLat, finalCenterLon, s.lat, s.lon);
          if (dist <= radiusKm) {
            eventSensors.push({
              id: s.id,
              name: s.name,
              lat: s.lat,
              lon: s.lon,
              county: s.county || '臺中市',
              status: s.status || '正常',
              pm2_5: (s as any).pm2_5 !== undefined ? (s as any).pm2_5 : 11.1,
              temperature: (s as any).temperature !== undefined ? (s as any).temperature : 28.5,
              humidity: (s as any).humidity !== undefined ? (s as any).humidity : 75.0,
              voc: (s as any).voc !== undefined ? (s as any).voc : null
            });
          }
        }

        if (eventSensors.length === 0 && sourceSensor) {
          eventSensors.push({
            id: sourceSensor.id,
            name: sourceSensor.name,
            lat: sourceSensor.lat,
            lon: sourceSensor.lon,
            county: sourceSensor.county || '臺中市',
            status: sourceSensor.status || '正常',
            pm2_5: (sourceSensor as any).pm2_5 !== undefined ? (sourceSensor as any).pm2_5 : 11.1,
            temperature: (sourceSensor as any).temperature !== undefined ? (sourceSensor as any).temperature : 28.5,
            humidity: (sourceSensor as any).humidity !== undefined ? (sourceSensor as any).humidity : 75.0,
            voc: (sourceSensor as any).voc !== undefined ? (sourceSensor as any).voc : null
          });
        }

        const eventTitle = `${fileName.replace('.shp', '')} 測試事件 (門檻: PM₂.₅ 54)`;
        const eventTimeStr = '2026-07-13 11:10:00'; // 固定在有完整氣象背景觀測的時間點，以利擴散播放
        
        await onAddEvent({
          title: eventTitle,
          description: `由前端上傳 Shapefile (${fileName}) 解析新增之測試事件`,
          status: '待確認',
          event_time: eventTimeStr,
          bounds: {
            center: { lat: finalCenterLat, lon: finalCenterLon },
            radiusKm: radiusKm
          },
          sensors: eventSensors
        });
        
        alert(`成功解析 ${fileName}！\n中心位置: ${centerLon.toFixed(6)}, ${centerLat.toFixed(6)}\n已新增事件至列表，可點擊「擴散」進行模擬。`);
      } catch (err: any) {
        console.error("SHP upload/parse error:", err);
        alert(`SHP 檔案解析失敗: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // 根據事件關聯的測站或 bounds 經緯度座標推算所屬產業園區，若無則回傳空
  const getEventTitle = (event: Event) => {
    let zone = '';

    // 1. 優先從 event.sensors 中查找第一個在園區內的
    if (event.sensors && event.sensors.length > 0 && sensorZoneMap) {
      for (const s of event.sensors) {
        const z = sensorZoneMap[s.id];
        if (z) {
          zone = z;
          break;
        }
      }
    }

    // 2. 其次從 bounds.center 座標反查最近的 sensor，並看該 sensor 是否在園區內
    if (!zone) {
      const center = event.bounds?.center;
      if (center && points && points.length > 0 && sensorZoneMap) {
        const lat = center.lat;
        const lon = (center as any).lon !== undefined ? (center as any).lon : (center as any).lng;
        if (lat !== undefined && lon !== undefined) {
          let nearestSensor = null;
          let minDistanceSq = Infinity;
          for (const p of points) {
            const dSq = Math.pow(p.lat - lat, 2) + Math.pow(p.lon - lon, 2);
            if (dSq < minDistanceSq) {
              minDistanceSq = dSq;
              nearestSensor = p;
            }
          }
          if (nearestSensor) {
            const z = sensorZoneMap[nearestSensor.id];
            if (z) zone = z;
          }
        }
      }
    }

    // 3. 備援：如果 title 裡面有寫死產業園區 (例如使用者手動輸入 "關連工業區-微感事件" 或 "關連工業區-事件管理")
    if (!zone && event.title) {
      const match = event.title.match(/(.*產業園區|.*工業區)-(微感事件|事件管理)/);
      if (match && match[1]) {
        zone = match[1];
      }
    }

    return zone ? `${zone}-微感事件` : '微感事件';
  };

  // 表單狀態
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'待確認' | '調查中' | '已結案'>('待確認');
  const [associatedSensors, setAssociatedSensors] = useState<Sensor[]>([]);

  // 當使用者在外面點選了感測器，並且點擊「關聯目前點位」時
  const handleAssociateCurrentSensor = () => {
    if (!selectedSensor) return;
    if (associatedSensors.some((s) => s.id === selectedSensor.id)) return;
    setAssociatedSensors([...associatedSensors, selectedSensor]);
  };

  const handleRemoveAssociatedSensor = (sensorId: string) => {
    setAssociatedSensors(associatedSensors.filter((s) => s.id !== sensorId));
  };

  const handleOpenAddForm = () => {
    setTitle('');
    setDescription('');
    setStatus('待確認');
    // 如果當前有選中的測站，預設把它放入關聯清單
    setAssociatedSensors(selectedSensor ? [selectedSensor] : []);
    setShowAddForm(true);
    setEditingEventId(null);
  };

  const handleOpenEditForm = (event: Event) => {
    setEditingEventId(event.id);
    setTitle(event.title);
    setDescription(event.description);
    setStatus(event.status);
    setAssociatedSensors(event.sensors || []);
    setShowAddForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // 將 associatedSensors 當時的測值打包
    const sensorsWithData = associatedSensors.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      county: s.county,
      status: s.status,
      pm2_5: (s as any).pm2_5 !== undefined ? (s as any).pm2_5 : null,
      temperature: (s as any).temperature !== undefined ? (s as any).temperature : null,
      humidity: (s as any).humidity !== undefined ? (s as any).humidity : null,
      voc: (s as any).voc !== undefined ? (s as any).voc : null,
    }));

    const eventTimeStr = currentDateTime.replace('T', ' ') + ':00';

    if (editingEventId) {
      await onUpdateEvent(editingEventId, {
        title,
        description,
        status,
        sensors: sensorsWithData,
        event_time: eventTimeStr
      });
    } else {
      await onAddEvent({
        title,
        description,
        status,
        sensors: sensorsWithData,
        event_time: eventTimeStr,
        bounds: associatedSensors.length > 0 ? {
          center: { lat: associatedSensors[0].lat, lon: associatedSensors[0].lon },
          radiusKm: 1.0
        } : null
      });
    }
    setShowAddForm(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-5 shadow-xl h-full overflow-hidden">
      {/* 標題 */}
      <div className="border-b border-slate-800 pb-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <AlertCircle className="text-orange-500 w-5 h-5" />
          <h2 className="text-lg font-bold text-slate-100">事件管理</h2>
        </div>
        <div>
          <button
            type="button"
            onClick={() => {
              const fileInput = document.getElementById('shp-file-input');
              if (fileInput) fileInput.click();
            }}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-all active:scale-95 cursor-pointer select-none shrink-0"
          >
            <PlusCircle className="w-3 h-3" />
            事件新增
          </button>
          <input
            id="shp-file-input"
            type="file"
            accept=".shp"
            onChange={handleShpUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* 新增或編輯事件表單 */}
      {showAddForm ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
            <h3 className="text-sm font-bold text-orange-400">
              {editingEventId ? '編輯事件' : '新增事件'}
            </h3>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-slate-500 hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-semibold">事件名稱</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如: 沙鹿區疑似露天燃燒"
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-semibold">事件詳情與描述</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="輸入可能的污染源特徵、擴散方向、風向等"
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-semibold">事件狀態</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 cursor-pointer"
            >
              <option value="待確認">待確認 (Unconfirmed)</option>
              <option value="調查中">調查中 (Investigating)</option>
              <option value="已結案">已結案 (Closed)</option>
            </select>
          </div>

          {/* 關聯感測器 */}
          <div className="flex flex-col gap-2 bg-slate-950/40 border border-slate-800/60 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                <Link className="w-3 h-3 text-slate-500" />
                關聯感測點 ({associatedSensors.length})
              </label>
              {selectedSensor && (
                <button
                  type="button"
                  onClick={handleAssociateCurrentSensor}
                  className="text-[10px] text-orange-400 hover:text-orange-500 font-bold flex items-center gap-0.5 cursor-pointer"
                >
                  <PlusCircle className="w-3 h-3" />
                  加入當前選擇點
                </button>
              )}
            </div>

            {associatedSensors.length === 0 ? (
              <p className="text-[10px] text-slate-500 italic py-2 text-center">
                尚未關聯任何感測站點。請點選地圖上的點後點選上方「加入當前選擇點」。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
                {associatedSensors.map((sensor) => (
                  <span
                    key={sensor.id}
                    className="inline-flex items-center gap-1 bg-slate-950 border border-slate-800 text-[10px] text-slate-300 px-2 py-0.5 rounded-lg"
                  >
                    <span>{sensor.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAssociatedSensor(sensor.id)}
                      className="text-red-400 hover:text-red-500 ml-1 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 rounded-xl text-sm transition-colors mt-2 cursor-pointer"
          >
            {editingEventId ? '儲存變更' : '建立事件'}
          </button>
        </form>
      ) : (
        /* 事件列表 */
        <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
          {events.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
              <FileText className="w-12 h-12 mb-3 text-slate-700" />
              <p className="text-sm font-bold text-slate-400">目前尚無事件。</p>
            </div>
          ) : (
            // 事件由舊到新排列，舊的編號小
            [...events].reverse().map((event, reverseIdx) => {
              const seqNum = reverseIdx + 1;
              const isExpanded = activeEventId === event.id;

              // 解析超標測值（從 dominant_type 或 description 推斷）
              const domType = event.dominant_type || '';
              const stationsCount = event.stations_count;
              const radiusKm = (event.bounds as any)?.radiusKm;
              const avgPm25 = event.avg_pm25;
              const threshMatch = event.title ? event.title.match(/\((門檻:[^\)]+)\)/) : null;
              const threshSuffix = threshMatch ? ` (${threshMatch[1]})` : '';

              // 判斷超標指標類型
              const hasPm25 = domType.includes('PM') || domType.includes('超標') || domType.includes('群聚') || avgPm25 != null;
              const hasTemp = domType.includes('溫度') || domType.includes('燃燒');
              const hasVoc = domType.includes('VOC') || domType.includes('排污');

              // 格式化事件時間（只取日期與時間，去秒數）
              const displayTime = event.event_time
                ? event.event_time.replace('T', ' ').substring(0, 16)
                : event.created_at?.substring(0, 16) || '--';

              return (
                <div key={event.id} className="flex flex-col">
                  {/* 按鈕列：點擊展開/收合 */}
                  <button
                    type="button"
                    onClick={() => onViewEvent(isExpanded ? null : event)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 border transition-all duration-200 cursor-pointer ${
                      isExpanded
                        ? 'bg-orange-500/10 border-orange-500/60 shadow-sm shadow-orange-500/10'
                        : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/40'
                    }`}
                  >
                    {/* 左側：流水號 + 標題 */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded border tabular-nums ${
                        isExpanded ? 'bg-orange-500 text-white border-orange-400' : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        #{String(seqNum).padStart(3, '0')}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className={`text-xs font-bold truncate ${isExpanded ? 'text-orange-300' : 'text-slate-200'}`}>
                            {getEventTitle(event)}
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const thresh = event.title ? (event.title.match(/門檻: PM₂.₅ (\d+(\.\d+)?)/)?.[1] || systemSettings?.pm25_threshold || 54) : (systemSettings?.pm25_threshold || 54);
                              const consecutive = systemSettings?.consecutive_exceeds || 3;
                              const radius = (event.bounds as any)?.radiusKm || systemSettings?.cluster_radius_km || 1.0;
                              const minStations = event.stations_count || systemSettings?.min_cluster_stations || 2;
                              alert(
                                `【事件判定規則】\n` +
                                `• 判定指標：PM₂.₅ 濃度\n` +
                                `• 異常門檻：大於等於 ${thresh} µg/m³\n` +
                                `• 連續判定：必須「連續 ${consecutive} 筆」測值皆超標\n` +
                                `• 空間群聚：在半徑 ${radius} km 內，至少有 ${minStations} 個測站符合上述超標條件`
                              );
                            }}
                            className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-orange-400 hover:text-orange-300 text-[9px] px-1 py-0.5 rounded border border-slate-750/80 font-black cursor-pointer shrink-0 transition-all select-none"
                            title="點擊查看此事件的判定規則"
                          >
                            規則
                          </button>
                          {/* 污染擴散模擬按鈕 */}
                          {onSimulateDispersion && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSimulateDispersion(event);
                              }}
                              className={`text-[9px] px-1.5 py-0.5 rounded border font-black cursor-pointer shrink-0 transition-all select-none flex items-center gap-0.5 ${
                                dispersionEventId === event.id
                                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 ring-1 ring-cyan-500/20'
                                  : 'bg-slate-800 hover:bg-cyan-900/40 text-slate-400 hover:text-cyan-300 border-slate-700 hover:border-cyan-500/40'
                              }`}
                              title={dispersionEventId === event.id ? '關閉擴散模擬' : '開啟擴散模擬'}
                            >
                              <Wind className="w-2.5 h-2.5" />
                              擴散
                            </button>
                          )}
                          {/* 刪除事件按鈕 (管理者 admin 專屬) */}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`確定要刪除事件「${getEventTitle(event)}」嗎？刪除後將無法復原。`)) {
                                  onDeleteEvent(event.id);
                                }
                              }}
                              className="text-[9px] px-1.5 py-0.5 rounded border font-black cursor-pointer shrink-0 transition-all select-none flex items-center gap-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border-red-500/30 active:scale-95"
                              title="管理者權限 (admin)：刪除此事件"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              刪除
                            </button>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                          ⏱ {displayTime}
                        </p>
                      </div>
                    </div>
                    {/* 右側：狀態標籤 + 箭頭 */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {event.status !== '待確認' && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                          event.status === '已結案'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : event.status === '調查中'
                            ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                            : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                        }`}>
                          {event.status}
                        </span>
                      )}
                      <span className={`text-slate-500 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                    </div>
                  </button>

                  {/* 展開內容：事件說明 */}
                  {isExpanded && (
                    <div className="mt-0.5 mx-1 rounded-xl border border-orange-500/20 bg-slate-950/80 p-3 flex flex-col gap-2.5">
                      
                      {/* 超標資訊 */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-orange-400 uppercase tracking-wider">超標資訊</span>
                        <div className="flex flex-wrap gap-2 text-xs">
                          {stationsCount != null && (
                            <span className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 font-semibold">
                              🏭 <span className="text-orange-400">{stationsCount}</span> 站超標
                            </span>
                          )}
                          {radiusKm != null && (
                            <span className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-300 font-semibold">
                              📍 距離 <span className="text-orange-400">{radiusKm}</span> km
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 超標測值指標 */}
                      {(hasPm25 || hasTemp || hasVoc) && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] font-black text-orange-400 uppercase tracking-wider">超標測值</span>
                          <div className="flex flex-wrap gap-1.5">
                            {hasPm25 && (
                              <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                PM₂.₅
                              </span>
                            )}
                            {hasTemp && (
                              <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                溫度
                              </span>
                            )}
                            {hasVoc && (
                              <span className="bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                VOC
                              </span>
                            )}
                          </div>
                        </div>
                      )}



                      {/* 刪除按鈕 */}
                      <div className="flex justify-end border-t border-slate-800/60 pt-2 mt-0.5">
                        <button
                          type="button"
                          onClick={() => onDeleteEvent(event.id)}
                          className="text-[10px] text-red-500/60 hover:text-red-400 font-bold py-1 px-2 rounded hover:bg-slate-900 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          刪除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

// 台灣 TWD97 (EPSG:3826) 轉 WGS84 經緯度 (EPSG:4326) 純數學投影公式
const twd97ToWgs84 = (x: number, y: number) => {
  const a = 6378137.0;
  const b = 6356752.314245;
  const long0 = (121.0 * Math.PI) / 180;
  const k0 = 0.9999;
  const dx = 250000.0;
  
  const dy = y;
  const xAdjusted = x - dx;
  
  const e = Math.sqrt(1 - (b * b) / (a * a));
  const e2 = (e * e) / (1 - e * e);
  
  const M = dy / k0;
  const mu = M / (a * (1 - (e * e) / 4 - 3 * (e * e * e * e) / 64 - 5 * (e * e * e * e * e * e) / 256));
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  
  const j1 = (3 * e1) / 2 - (27 * e1 * e1 * e1) / 32;
  const j2 = (21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32;
  const j3 = (151 * e1 * e1 * e1) / 96;
  const j4 = (1097 * e1 * e1 * e1 * e1) / 512;
  
  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
  
  const C1 = e2 * Math.cos(fp) * Math.cos(fp);
  const T1 = Math.tan(fp) * Math.tan(fp);
  const R1 = (a * (1 - e * e)) / Math.pow(1 - (e * e) * Math.sin(fp) * Math.sin(fp), 1.5);
  const N1 = a / Math.sqrt(1 - (e * e) * Math.sin(fp) * Math.sin(fp));
  const D = xAdjusted / (N1 * k0);
  
  const Q1 = (D * D) / 2;
  const Q2 = ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * Math.pow(D, 4)) / 24;
  const Q3 = ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 3 * C1 * C1 - 252 * e2) * Math.pow(D, 6)) / 720;
  let lat = fp - (N1 * Math.tan(fp) / R1) * (Q1 - Q2 + Q3);
  lat = (lat * 180) / Math.PI;
  
  const Q4 = D;
  const Q5 = ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6;
  const Q6 = ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * Math.pow(D, 5)) / 120;
  let lon = long0 + (Q4 - Q5 + Q6) / Math.cos(fp);
  lon = (lon * 180) / Math.PI;
  
  return { lon, lat };
};

const getDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export default EventManager;
