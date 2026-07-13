'use client';

import React, { useState, useEffect } from 'react';
import { Event, Sensor } from '@/types';
import { AlertCircle, FileText, Trash2, X, PlusCircle, Link } from 'lucide-react';

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
  currentDateTime
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

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
        {/* 已改為達到門檻自動生成事件，移除手動新增事件按鈕 */}
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
                        <p className={`text-xs font-bold truncate ${isExpanded ? 'text-orange-300' : 'text-slate-200'}`}>
                          微感超標群聚事件{threshSuffix}
                        </p>
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

                      {/* 平均測值 */}
                      {avgPm25 != null && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] font-black text-orange-400 uppercase tracking-wider">平均 PM₂.₅ 濃度</span>
                          <span className="text-lg font-black text-red-400 tabular-nums">
                            {avgPm25.toFixed(1)}
                            <span className="text-[11px] text-slate-500 font-normal ml-1">µg/m³</span>
                          </span>
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

export default EventManager;
