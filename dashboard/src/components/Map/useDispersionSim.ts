import { useState, useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { Event, Sensor, Observation, EventSensorDetail } from '@/types';

// 取得擴散模擬的污染源測站 (Supabase 模式下若 sensors 為空，則從 points 尋找距離 bounds 中心最近的測站)
export const getEventSourceSensor = (
  event: Event | null | undefined,
  points: (Sensor & Observation)[]
): EventSensorDetail | null => {
  if (!event) return null;
  if (event.sensors && event.sensors.length > 0) {
    return event.sensors[0];
  }
  if (event.bounds?.center && points.length > 0) {
    const center = event.bounds.center;
    const centerLon = (center as any).lon ?? (center as any).lng;
    const centerLat = center.lat;
    if (centerLon && centerLat) {
      let minDistance = Infinity;
      let nearestSensor = null;
      for (const p of points) {
        const dLon = p.lon - centerLon;
        const dLat = p.lat - centerLat;
        const dist = dLon * dLon + dLat * dLat;
        if (dist < minDistance) {
          minDistance = dist;
          nearestSensor = p;
        }
      }
      if (nearestSensor) {
        return {
          id: nearestSensor.id,
          name: nearestSensor.name,
          lat: nearestSensor.lat,
          lon: nearestSensor.lon,
          county: nearestSensor.county,
          status: nearestSensor.status,
          pm2_5: nearestSensor.pm2_5 ?? null,
          temperature: nearestSensor.temperature ?? null,
          humidity: nearestSensor.humidity ?? null,
          voc: nearestSensor.voc ?? null
        };
      }
    }
  }
  return null;
};

// 結合 Mapbox 實測高程與臺中地形數學模型，確保無地形高程資料時（如瓦片加載中）依然有穩定、顯著的地形阻擋效果
export const getElevation = (
  lon: number,
  lat: number,
  map: mapboxgl.Map | null
): number => {
  let mapboxElev: number | null | undefined = null;
  if (map) {
    try {
      mapboxElev = map.queryTerrainElevation([lon, lat]);
    } catch {}
  }

  // 若 Mapbox 高程查詢可用且大於 0，優先使用 (並乘上擴張係數以增強視覺效果)
  if (mapboxElev !== null && mapboxElev !== undefined && mapboxElev > 0) {
    return mapboxElev * 1.5;
  }

  // 否則，使用臺中盆地到東側山區的經度高程斷面數學模型作為 Backup
  let elev = 60; // 預設台中盆地平原海拔
  if (lon > 120.70) {
    // 東側山區阻擋 (太平、大坑山區)
    const dx = lon - 120.70;
    elev = 100 + dx * 4200; // 海拔快速從 100m 爬升至 500m 以上
    elev += Math.sin(lon * 200) * 80 + Math.cos(lat * 150) * 50; // 山脊與山谷波折
  } else if (lon > 120.53 && lon < 120.61) {
    // 大肚山台地
    const mid = 120.57;
    const width = 0.04;
    const dist = Math.abs(lon - mid);
    if (dist < width) {
      const t = 1 - (dist / width);
      elev = 60 + t * t * 240; // 最高處約 300m
    }
  } else if (lon <= 120.53) {
    // 西側海岸
    elev = Math.max(5, 5 + (lon - 120.30) * 200);
  }
  return Math.max(0, elev);
};

// 依據日照（白天/夜間）與風速判斷 Pasquill-Gifford 大氣穩定度 A~F
export const getStabilityClass = (
  isDay: boolean,
  windSpeed: number
): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' => {
  if (isDay) {
    if (windSpeed < 2) return 'A'; // 強日照、極不穩定 (大範圍稀釋)
    if (windSpeed < 3) return 'B'; // 中度不穩定
    if (windSpeed < 5) return 'C'; // 微幅不穩定
    return 'D';                    // 強風中性
  } else {
    if (windSpeed < 2) return 'F'; // 夜間低風速、極度穩定 (窄帶高濃度)
    if (windSpeed < 3) return 'E'; // 夜間微風、微幅穩定
    return 'D';                    // 夜間強風中性
  }
};

// 計算 Briggs 橫向擴散係數 (Rural 鄉村地形條件公式)
export const getBriggsSigmaY = (
  stability: 'A' | 'B' | 'C' | 'D' | 'E' | 'F',
  xMeters: number
): number => {
  const x = Math.max(1.0, xMeters);
  let alpha = 0.08;
  switch (stability) {
    case 'A': alpha = 0.22; break;
    case 'B': alpha = 0.16; break;
    case 'C': alpha = 0.11; break;
    case 'D': alpha = 0.08; break;
    case 'E': alpha = 0.06; break;
    case 'F': alpha = 0.04; break;
  }
  return (alpha * x) / Math.sqrt(1.0 + 0.0001 * x);
};

interface UseDispersionSimProps {
  map: mapboxgl.Map | null;
  isLoaded: boolean;
  dispersionEvent: Event | null | undefined;
  playTrigger: number;
  points: (Sensor & Observation)[];
  setShowWindArrows: (show: boolean) => void;
  windVectorsRef: React.MutableRefObject<any[]>;
}

export function useDispersionSim({
  map,
  isLoaded,
  dispersionEvent,
  playTrigger,
  points,
  setShowWindArrows,
  windVectorsRef
}: UseDispersionSimProps) {
  const [simTimeH, setSimTimeH] = useState(0);
  const simAnimRef = useRef<number | null>(null);
  const simStartTimeRef = useRef<number | null>(null);
  const simHoldStartRef = useRef<number | null>(null);
  const simPhaseRef = useRef<'animating' | 'holding'>('animating');
  const prevEventIdRef = useRef<string | undefined>(undefined);
  const prevPlayTriggerRef = useRef<number>(0);

  const dispersionEventRef = useRef(dispersionEvent);
  useEffect(() => {
    dispersionEventRef.current = dispersionEvent;
  }, [dispersionEvent]);

  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  // 3.3 污染擴散模擬：Gaussian Puff 動畫引擎
  useEffect(() => {
    if (!map || !isLoaded) return;

    const currentEventId = dispersionEvent?.id;
    const isEventChanged = currentEventId !== prevEventIdRef.current;
    const isPlayTriggerChanged = playTrigger !== prevPlayTriggerRef.current;

    // 只有在事件改變或使用者手動點擊重新播放時，才重新初始化動畫，防止輪詢 (poll) 導致自動重播
    if (!isEventChanged && !isPlayTriggerChanged) {
      return;
    }
    prevEventIdRef.current = currentEventId;
    prevPlayTriggerRef.current = playTrigger;

    if (simAnimRef.current) {
      cancelAnimationFrame(simAnimRef.current);
      simAnimRef.current = null;
    }

    if (!dispersionEventRef.current) {
      const dispCanvas = document.getElementById('dispersion-canvas') as HTMLCanvasElement | null;
      if (dispCanvas) {
        dispCanvas.getContext('2d')?.clearRect(0, 0, dispCanvas.width, dispCanvas.height);
      }
      try { map.getLayer('dispersion-canvas-layer') && map.setLayoutProperty('dispersion-canvas-layer', 'visibility', 'none'); } catch {}
      setSimTimeH(0);
      simStartTimeRef.current = null;
      simPhaseRef.current = 'animating';
      return;
    }

    setShowWindArrows(false);
    try { map.getLayer('dispersion-canvas-layer') && map.setLayoutProperty('dispersion-canvas-layer', 'visibility', 'visible'); } catch {}

    const dispCanvas = document.getElementById('dispersion-canvas') as HTMLCanvasElement | null;
    if (!dispCanvas) return;
    const dCtx = dispCanvas.getContext('2d');
    if (!dCtx) return;

    // 立刻清空畫布，避免殘留上一輪模擬的最後一幀導致視覺卡頓/回放閃爍
    dCtx.clearRect(0, 0, dispCanvas.width, dispCanvas.height);

    const srcSensor = getEventSourceSensor(dispersionEventRef.current, pointsRef.current);
    if (!srcSensor) return;
    const srcLon = srcSensor.lon;
    const srcLat = srcSensor.lat;
    const realPm25: number = (srcSensor as any).pm2_5 ?? 50;
    // 為了確保模擬播放時能展現清晰的等值線（Contour）色彩層次，設定最低模擬源頭濃度為 60 µg/m³
    const srcPm25 = Math.max(realPm25, 60.0);

    if (windVectorsRef.current.length === 0 && pointsRef.current.length > 0) {
      windVectorsRef.current = pointsRef.current.map((p: any) => {
        const lon = p.lon; const lat = p.lat;
        const hour = new Date().getHours();
        const isCoastal = lon < 120.55; const isMountain = lon > 120.75;
        const isDay = hour >= 7 && hour <= 18;
        let baseWd = isCoastal ? (isDay ? 250 : 65) : isMountain ? (isDay ? 290 : 110) : (isDay ? 220 : 45);
        const baseWs = isCoastal ? (isDay ? 6.5 : 4.2) : isMountain ? (isDay ? 3.8 : 2.5) : (isDay ? 5.0 : 3.5);
        baseWd = (baseWd + (lat - 24.15) * 15 + 360) % 360;
        let hash = 0;
        for (const c of String(p.id || '')) hash += c.charCodeAt(0);
        const wd = (baseWd + (hash % 41) - 20 + 360) % 360;
        const ws = Math.max(1.5, baseWs + ((hash % 31) - 15) / 10);
        const rad = ((wd + 180) * Math.PI) / 180;
        const scale = 0.00045 * ws;
        return { id: p.id, lon, lat, dLon: Math.sin(rad) * scale, dLat: Math.cos(rad) * scale, hashOffset: 0, ws };
      });
    }

    let sumW = 0, sumLon = 0, sumLat = 0, sumWs = 0;
    for (const v of windVectorsRef.current) {
      const dLon = srcLon - v.lon; const dLat = srcLat - v.lat;
      const w = 1.0 / (dLon * dLon + dLat * dLat + 0.000001);
      sumW += w; sumLon += v.dLon * w; sumLat += v.dLat * w; sumWs += v.ws * w;
    }
    const windDLon = sumW > 0 ? sumLon / sumW : 0.0003;
    const windDLat = sumW > 0 ? sumLat / sumW : 0.0002;
    const windSpeedMs = sumW > 0 ? sumWs / sumW : 4.0;
    const windToRad = Math.atan2(windDLon, windDLat);

    const eventTimeStr = dispersionEventRef.current.event_time || dispersionEventRef.current.start_time || new Date().toISOString();
    const eventHour = new Date(eventTimeStr.replace('T', ' ').replace(/-/g, '/')).getHours();
    const eventIsDay = eventHour >= 7 && eventHour <= 18;
    const stability = getStabilityClass(eventIsDay, windSpeedMs);

    const MIN_LON = 120.30, MAX_LON = 120.98, MIN_LAT = 23.85, MAX_LAT = 24.45;
    const lonWidth = MAX_LON - MIN_LON;
    const latHeight = MAX_LAT - MIN_LAT;
    const mPerDegLon = 111000 * Math.cos(srcLat * Math.PI / 180);
    const mPerDegLat = 111000;
    const mPerPxX = lonWidth * mPerDegLon / dispCanvas.width;
    const mPerPxY = latHeight * mPerDegLat / dispCanvas.height;
    const srcX = ((srcLon - MIN_LON) / lonWidth) * dispCanvas.width;
    const srcY = ((MAX_LAT - srcLat) / latHeight) * dispCanvas.height;

    const getColor = (currentPm25: number, opacity: number) => {
      if (currentPm25 >= 54.4) return `rgba(239,68,68,${opacity.toFixed(3)})`;
      if (currentPm25 >= 35.4) return `rgba(249,115,22,${opacity.toFixed(3)})`;
      if (currentPm25 >= 15.5) return `rgba(234,179,8,${opacity.toFixed(3)})`;
      return `rgba(52,211,153,${opacity.toFixed(3)})`;
    };

    simPhaseRef.current = 'animating';
    simStartTimeRef.current = null;
    simHoldStartRef.current = null;

    const SIM_REAL_S = 20; // 運行速度放慢為原先的 0.5 倍

    const drawFrame = (tHours: number) => {
      dCtx.clearRect(0, 0, dispCanvas.width, dispCanvas.height);
      if (tHours < 0.02) return;
      const K = 50;
      const layerCount = Math.min(Math.floor(tHours * 6) + 1, 24);
      
      const sourceElev = getElevation(srcLon, srcLat, map);

      for (let li = 0; li < layerCount; li++) {
        const fraction = 1 - li / layerCount;
        const tLayer = tHours * (fraction * 0.6 + 0.4);
        const currPm25 = srcPm25 * Math.exp(-0.45 * tLayer);
        const t_sL = tLayer * 3600;

        const LOCAL_SCALE = 0.085; // 引入局地尺度折減係數，使 4 小時動畫擴散控制在合理局地範圍 (最大約 4.5~5 公里)

        // 採用 Briggs 橫向擴散係數與順風向擴散折算
        const travelDist = windSpeedMs * t_sL * LOCAL_SCALE;
        const sigmaY = getBriggsSigmaY(stability, travelDist);
        const sigmaX = sigmaY * 1.4;
        let sxPx = Math.max(sigmaX / mPerPxX, 2);
        let syPx = Math.max(sigmaY / mPerPxY, 2);
        const dMX = travelDist * Math.sin(windToRad);
        const dMY = travelDist * Math.cos(windToRad);

        // 原始預計位置
        const targetLon = srcLon + dMX / mPerDegLon;
        const targetLat = srcLat + dMY / mPerDegLat;

        // 地形海拔高度檢測與折減 (以 source 為基準)
        const targetElev = getElevation(targetLon, targetLat, map);
        const midLon = (srcLon + targetLon) / 2;
        const midLat = (srcLat + targetLat) / 2;
        const midElev = getElevation(midLon, midLat, map);

        const maxElevDiff = Math.max(0, targetElev - sourceElev, midElev - sourceElev);

        // 位移折減：高度差超過 30 公尺開始阻擋，超過 120 公尺則幾乎折減到底，模擬撞山障礙
        let travelFactor = 1.0;
        if (maxElevDiff > 30) {
          travelFactor = Math.max(0.2, 1.0 - (maxElevDiff - 30) / 90);
        }

        // 折減後實際粒子位置
        const adjLon = srcLon + (dMX / mPerDegLon) * travelFactor;
        const adjLat = srcLat + (dMY / mPerDegLat) * travelFactor;

        // 計算該處的局部高程差，模擬撞山積累與擠壓
        const actualElev = getElevation(adjLon, adjLat, map);
        const actualElevDiff = Math.max(0, actualElev - sourceElev);

        // 濃度積累係數：撞山時，風速降低，濃度（不透明度）增加最多 2.0 倍
        let accumulationFactor = 1.0;
        if (actualElevDiff > 10) {
          accumulationFactor = 1.0 + Math.min(actualElevDiff / 50, 1.0);
        }

        // 擴散壓縮係數：氣流撞山受阻，水平與垂直擴散受壓制而變窄
        let compressFactor = 1.0;
        if (actualElevDiff > 20) {
          compressFactor = Math.max(0.65, 1.0 - (actualElevDiff - 20) / 150);
        }

        const pX = ((adjLon - MIN_LON) / lonWidth) * dispCanvas.width;
        const pY = ((MAX_LAT - adjLat) / latHeight) * dispCanvas.height;

        // 放寬撞山沉降判定，避免粒子因地形高度差稍微增加就完全隱形消失，保留撞山堆積效果
        let depositionFactor = 1.0;
        if (actualElevDiff > 120) {
          depositionFactor = Math.max(0.4, 1.0 - (actualElevDiff - 120) / 400);
        }

        // 隨時間呈指數衰減 (e^-0.45t)，模擬擴散稀釋與乾沉降，吹越遠越淡
        const timeDecay = Math.exp(-0.45 * tHours);
        let opacity = Math.max(0.01, 0.28 * timeDecay * fraction) * accumulationFactor * depositionFactor;
        opacity = Math.min(opacity, 0.65); // 防止不透明度過高

        sxPx = sxPx * compressFactor;
        syPx = syPx * compressFactor;

        // 嚴格數值安全防護，避免任何 NaN 導致 Canvas 繪圖靜默失敗
        const safeNum = (v: any, def = 0): number => {
          return (typeof v === 'number' && !isNaN(v)) ? v : def;
        };

        const finalPx = safeNum(pX, srcX);
        const finalPy = safeNum(pY, srcY);
        const finalRadius = Math.max(safeNum(syPx * 3, 12), 12);
        const finalOpacity = Math.min(Math.max(safeNum(opacity, 0.25), 0.02), 0.95);
        const finalScaleX = Math.max(safeNum(sxPx / Math.max(syPx, 1), 1.0), 1.0);
        const finalWindToRad = safeNum(windToRad, 0);

        dCtx.save();
        dCtx.translate(finalPx, finalPy);
        dCtx.rotate(finalWindToRad);
        dCtx.scale(finalScaleX, 1);

        // 階梯式高斯等值帶漸變產生器 (還原專業數值模擬的視覺質感)
        const getContourColor = (val: number, op: number) => {
          // 提供綠色與黃色最低能見度保障，避免在深色背景下過於黯淡
          const minOp = (o: number) => Math.max(o, 0.18).toFixed(3);
          const stdOp = (o: number) => o.toFixed(3);

          if (val >= 250.4) return `rgba(127, 29, 29, ${stdOp(op)})`;   // 褐紅
          if (val >= 150.4) return `rgba(168, 85, 247, ${stdOp(op)})`;  // 紫色
          if (val >= 54.4) return `rgba(239, 68, 68, ${stdOp(op)})`;   // 紅色
          if (val >= 35.4) return `rgba(249, 115, 22, ${stdOp(op)})`;  // 橘色
          if (val >= 15.5) return `rgba(234, 179, 8, ${minOp(op)})`;   // 黃色
          return `rgba(52, 211, 153, ${minOp(op)})`;                  // 綠色
        };

        const grad = dCtx.createRadialGradient(0, 0, 0, 0, 0, finalRadius);
        const thresholds = [250.4, 150.4, 54.4, 35.4, 15.5];
        const boundaries: { x: number; val: number }[] = [];
        
        // 依高斯剖面分佈 C(x) = C_max * exp(-1.8 * x^2) 反推各等值線界線的相對半徑 x
        const safeCurrPm = safeNum(currPm25, 0);
        for (const T of thresholds) {
          if (safeCurrPm > T) {
            const x = Math.sqrt(Math.log(safeCurrPm / T) / 1.8);
            if (x < 1.0) {
              boundaries.push({ x, val: T });
            }
          }
        }
        boundaries.sort((a, b) => a.x - b.x);

        // 收集所有漸變 Stop 點，以排序與去重機制防範 addColorStop 位置非單調遞增所造成的 Canvas Exception
        const stops: { offset: number; color: string }[] = [];
        
        // 中心點
        stops.push({ offset: 0, color: getContourColor(safeCurrPm, finalOpacity) });
        
        for (const b of boundaries) {
          const bX = Math.min(b.x, 0.99);
          const opBefore = finalOpacity * Math.max(0.1, 1 - bX * bX);
          stops.push({ offset: bX, color: getContourColor(b.val + 0.1, opBefore) });
          
          const bXNext = Math.min(bX + 0.015, 0.995);
          const opAfter = finalOpacity * Math.max(0.1, 1 - bXNext * bXNext);
          stops.push({ offset: bXNext, color: getContourColor(b.val - 0.1, opAfter) });
        }
        
        // 邊緣淡出到完全透明
        stops.push({ offset: 1.0, color: getContourColor(0, 0) });
        
        // 1. 依 offset 由小到大進行排序 (確保單調遞增)
        stops.sort((a, b) => a.offset - b.offset);
        
        // 2. 進行去重與極度鄰近位置覆蓋處理，預防浮點數精度或多邊界擠壓引發的 Exception
        const uniqueStops: { offset: number; color: string }[] = [];
        for (const s of stops) {
          const safeOffset = Math.max(0, Math.min(1.0, safeNum(s.offset, 0)));
          if (uniqueStops.length > 0 && Math.abs(uniqueStops[uniqueStops.length - 1].offset - safeOffset) < 0.0002) {
            // 如果相鄰兩個 Stop 距離小於 0.0002 則直接覆蓋，避免 Canvas 核心報錯
            uniqueStops[uniqueStops.length - 1].color = s.color;
          } else {
            uniqueStops.push({ offset: safeOffset, color: s.color });
          }
        }
        
        // 3. 安全呼叫 addColorStop
        for (const s of uniqueStops) {
          grad.addColorStop(s.offset, s.color);
        }

        dCtx.beginPath();
        dCtx.arc(0, 0, finalRadius, 0, Math.PI * 2);
        dCtx.fillStyle = grad;
        dCtx.fill();
        dCtx.restore();
      }
      // 煙包中心位置 (t=current)
      const LOCAL_SCALE = 0.085;
      const t_s = tHours * 3600;
      const dMXt = windSpeedMs * t_s * Math.sin(windToRad) * LOCAL_SCALE;
      const dMYt = windSpeedMs * t_s * Math.cos(windToRad) * LOCAL_SCALE;

      const tTargetLon = srcLon + dMXt / mPerDegLon;
      const tTargetLat = srcLat + dMYt / mPerDegLat;
      const tTargetElev = getElevation(tTargetLon, tTargetLat, map);
      const tMidLon = (srcLon + tTargetLon) / 2;
      const tMidLat = (srcLat + tTargetLat) / 2;
      const tMidElev = getElevation(tMidLon, tMidLat, map);

      const tMaxElevDiff = Math.max(0, tTargetElev - sourceElev, tMidElev - sourceElev);
      let tTravelFactor = 1.0;
      if (tMaxElevDiff > 30) {
        tTravelFactor = Math.max(0.2, 1.0 - (tMaxElevDiff - 30) / 90);
      }

      const tAdjLon = srcLon + (dMXt / mPerDegLon) * tTravelFactor;
      const tAdjLat = srcLat + (dMYt / mPerDegLat) * tTravelFactor;

      const puffX = ((tAdjLon - MIN_LON) / lonWidth) * dispCanvas.width;
      const puffY = ((MAX_LAT - tAdjLat) / latHeight) * dispCanvas.height;
      // 軌跡虛線 (維持不用消失)
      if (tHours > 0.15) {
        dCtx.beginPath();
        dCtx.moveTo(srcX, srcY);
        dCtx.lineTo(puffX, puffY);
        dCtx.setLineDash([6, 6]);
        dCtx.strokeStyle = getColor(srcPm25, 0.3);
        dCtx.lineWidth = 1.5;
        dCtx.stroke();
        dCtx.setLineDash([]);
      }
      // 來源標記
      dCtx.beginPath(); dCtx.arc(srcX, srcY, 5, 0, Math.PI * 2); dCtx.fillStyle = getColor(srcPm25, 0.9); dCtx.fill();
      dCtx.beginPath(); dCtx.arc(srcX, srcY, 9, 0, Math.PI * 2); dCtx.strokeStyle = getColor(srcPm25, 0.4); dCtx.lineWidth = 1.5; dCtx.stroke();
      // 小時標記 1h / 2h / 3h
      for (let h = 1; h <= Math.min(Math.floor(tHours), 3); h++) {
        const LOCAL_SCALE = 0.085;
        const hMX = windSpeedMs * h * 3600 * Math.sin(windToRad) * LOCAL_SCALE;
        const hMY = windSpeedMs * h * 3600 * Math.cos(windToRad) * LOCAL_SCALE;
        const hX = ((srcLon + hMX / mPerDegLon - MIN_LON) / lonWidth) * dispCanvas.width;
        const hY = ((MAX_LAT - (srcLat + hMY / mPerDegLat)) / latHeight) * dispCanvas.height;
        dCtx.beginPath(); dCtx.arc(hX, hY, 3, 0, Math.PI * 2); dCtx.fillStyle = 'rgba(255,255,255,0.6)'; dCtx.fill();
        dCtx.fillStyle = 'rgba(255,255,255,0.8)'; dCtx.font = 'bold 11px Inter, sans-serif'; dCtx.fillText(`${h}h`, hX + 7, hY - 4);
      }
      try { (map.getSource('dispersion-canvas-source') as mapboxgl.CanvasSource)?.play(); } catch {}
      map.triggerRepaint();
    };

    const animate = (timestamp: number) => {
      if (simPhaseRef.current === 'holding') {
        setSimTimeH(4.0);
        drawFrame(4.0);
        return;
      }
      if (!simStartTimeRef.current) simStartTimeRef.current = timestamp;
      const tHours = Math.min(((timestamp - simStartTimeRef.current) / 1000 / SIM_REAL_S) * 4, 4);
      setSimTimeH(tHours);
      drawFrame(tHours);
      if (tHours >= 4) {
        simPhaseRef.current = 'holding';
      } else {
        simAnimRef.current = requestAnimationFrame(animate);
      }
    };

    simAnimRef.current = requestAnimationFrame(animate);

    return () => {
      if (simAnimRef.current) { cancelAnimationFrame(simAnimRef.current); simAnimRef.current = null; }
    };
  }, [dispersionEvent?.id, isLoaded, playTrigger, map]);

  return {
    simTimeH,
    setSimTimeH,
    simAnimRef,
    simPhaseRef,
    simStartTimeRef,
    simHoldStartRef
  };
}
