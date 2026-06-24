'use client';

import React, { useState, useEffect } from 'react';
import { Event, Sensor } from '@/types';
import { AlertCircle, Plus, CheckCircle, FileText, Settings, Trash2, X, PlusCircle, Link, MapPin } from 'lucide-react';

interface EventManagerProps {
  selectedSensor: Sensor | null;
  onSelectSensor: (sensorId: string) => void;
  // 事件 API 操作
  events: Event[];
  onAddEvent: (eventData: Omit<Event, 'id' | 'created_at' | 'updated_at'> & { sensorIds: string[] }) => Promise<void>;
  onUpdateEvent: (eventId: string, eventData: Partial<Event> & { sensorIds?: string[] }) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
  isLoading: boolean;
}

export const EventManager: React.FC<EventManagerProps> = ({
  selectedSensor,
  onSelectSensor,
  events,
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  isLoading
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

    const sensorIds = associatedSensors.map((s) => s.id);

    if (editingEventId) {
      await onUpdateEvent(editingEventId, {
        title,
        description,
        status,
        sensorIds
      });
    } else {
      await onAddEvent({
        title,
        description,
        status,
        sensorIds,
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
          <h2 className="text-lg font-bold text-slate-100">疑似排汙事件管理</h2>
        </div>
        {!showAddForm && (
          <button
            onClick={handleOpenAddForm}
            className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            新增事件
          </button>
        )}
      </div>

      {/* 新增或編輯事件表單 */}
      {showAddForm ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
            <h3 className="text-sm font-bold text-orange-400">
              {editingEventId ? '編輯排汙事件' : '新增疑似排汙事件'}
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
              placeholder="輸入可能的汙染源特徵、擴散方向、風向等"
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
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
          {events.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
              <FileText className="w-12 h-12 mb-3 text-slate-700" />
              <p className="text-sm font-bold mb-1">尚未建立任何排汙事件</p>
              <p className="text-xs text-slate-600 max-w-[200px] leading-relaxed">
                若在地圖上發現疑似超標的紅色熱區，可點擊上方「新增事件」進行人工追蹤管理。
              </p>
            </div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="bg-slate-950/60 border border-slate-850 hover:border-slate-800 rounded-xl p-4 flex flex-col gap-3 transition-colors relative group"
              >
                {/* 狀態標籤 */}
                <div className="absolute top-4 right-4 flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      event.status === '已結案'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : event.status === '調查中'
                        ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                        : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                    }`}
                  >
                    {event.status}
                  </span>
                </div>

                {/* 標題與更新時間 */}
                <div>
                  <h4 className="font-bold text-slate-200 text-sm max-w-[70%]">{event.title}</h4>
                  <span className="text-[10px] text-slate-500">{event.updated_at}</span>
                </div>

                {/* 描述 */}
                {event.description && (
                  <p className="text-xs text-slate-400 leading-relaxed bg-slate-900/40 p-2.5 rounded-lg border border-slate-900/60">
                    {event.description}
                  </p>
                )}

                {/* 關聯感測器 */}
                {event.sensors && event.sensors.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t border-slate-850 pt-2.5 mt-1">
                    <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                      <Link className="w-3 h-3" />
                      已關聯感測器 ({event.sensors.length})
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {event.sensors.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => onSelectSensor(s.id)}
                          className="bg-slate-900 hover:bg-slate-800 text-[9px] text-slate-300 px-2 py-0.5 rounded border border-slate-800 flex items-center gap-0.5 transition-colors cursor-pointer"
                        >
                          <MapPin className="w-2.5 h-2.5 text-orange-500" />
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 操作按鈕 */}
                <div className="flex justify-end gap-2 border-t border-slate-850 pt-2.5 mt-1 opacity-60 hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleOpenEditForm(event)}
                    className="text-xs text-slate-400 hover:text-orange-400 font-bold py-1 px-2.5 rounded hover:bg-slate-900 flex items-center gap-1 cursor-pointer"
                  >
                    <Settings className="w-3 h-3" />
                    編輯
                  </button>
                  <button
                    onClick={() => onDeleteEvent(event.id)}
                    className="text-xs text-red-500 hover:text-red-400 font-bold py-1 px-2.5 rounded hover:bg-slate-900 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    刪除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default EventManager;
