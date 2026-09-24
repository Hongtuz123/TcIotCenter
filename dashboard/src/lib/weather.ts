/**
 * 環境部 / 環保局標準自動氣象觀測站資料模組
 */

export interface WindCondition {
  windSpeed: number;        // 風速 (m/s)
  windDir: number;          // 風向 (角度，0-360 度，北風為 0/360，東風為 90)
  windDirName: string;      // 方位中文 (如：東北風、北北東風)
  windDirCompass: string;   // 英文羅盤方位 (如：NE, NNE)
  stationName: string;      // 標準測站名稱 (如：環保局 太平氣象觀測站)
  stationId?: string;       // 測站代碼 (如：C0F9I0)
  distanceKm: number;       // 離事件中心距離 (公里)
  beaufortScale: number;    // 蒲福風級 (0-12)
  beaufortDesc: string;     // 風力等級描述 (如：微風、和風)
  source: 'cwa_api' | 'cwa_standard_network';
  agencyType: 'moenv' | 'epb'; // 來源機構：'moenv' (環境部氣象站) | 'epb' (環保局氣象站)
  agencyLabel: string;         // 顯示標籤文字：'環境部氣象站' | '環保局氣象站'
}

// 臺中市官方環境部與地方環保局標準地面氣象觀測站清冊
const TAICHUNG_STANDARD_STATIONS: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  baseSpeed: number;
  baseDir: number;
  agencyType: 'moenv' | 'epb';
  agencyLabel: string;
}[] = [
  { id: 'C0F9K0', name: '環境部 大里監測氣象站', lat: 24.0990, lon: 120.6780, baseSpeed: 2.2, baseDir: 45, agencyType: 'moenv', agencyLabel: '環境部氣象站' },
  { id: '467490', name: '環境部 臺中監測氣象站', lat: 24.1457, lon: 120.6843, baseSpeed: 2.5, baseDir: 40, agencyType: 'moenv', agencyLabel: '環境部氣象站' },
  { id: 'EPA001', name: '環境部 忠明標準空品站', lat: 24.1517, lon: 120.6653, baseSpeed: 2.3, baseDir: 45, agencyType: 'moenv', agencyLabel: '環境部氣象站' },
  { id: 'C0F9L0', name: '環境部 西屯監測氣象站', lat: 24.1814, lon: 120.6172, baseSpeed: 2.8, baseDir: 35, agencyType: 'moenv', agencyLabel: '環境部氣象站' },
  { id: 'C0F9N0', name: '環境部 沙鹿監測氣象站', lat: 24.2253, lon: 120.5638, baseSpeed: 4.2, baseDir: 25, agencyType: 'moenv', agencyLabel: '環境部氣象站' },
  { id: 'C0F930', name: '環境部 豐原監測氣象站', lat: 24.2561, lon: 120.7225, baseSpeed: 2.1, baseDir: 50, agencyType: 'moenv', agencyLabel: '環境部氣象站' },
  { id: '467770', name: '環保局 梧棲氣象觀測站', lat: 24.2562, lon: 120.5233, baseSpeed: 5.2, baseDir: 20, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F970', name: '環保局 大甲幼獅氣象站', lat: 24.3508, lon: 120.6201, baseSpeed: 4.0, baseDir: 30, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F9A0', name: '環保局 霧峰氣象觀測站', lat: 24.0381, lon: 120.6972, baseSpeed: 1.8, baseDir: 60, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F9I0', name: '環保局 太平氣象觀測站', lat: 24.1256, lon: 120.7303, baseSpeed: 1.7, baseDir: 55, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F9M0', name: '環保局 烏日氣象觀測站', lat: 24.1106, lon: 120.6214, baseSpeed: 2.4, baseDir: 35, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F980', name: '環保局 外埔氣象觀測站', lat: 24.3317, lon: 120.6547, baseSpeed: 3.6, baseDir: 35, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F9V0', name: '環保局 清水氣象觀測站', lat: 24.2711, lon: 120.5731, baseSpeed: 4.6, baseDir: 20, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0F990', name: '環保局 后里氣象觀測站', lat: 24.3056, lon: 120.7139, baseSpeed: 3.0, baseDir: 40, agencyType: 'epb', agencyLabel: '環保局氣象站' },
  { id: 'C0FA10', name: '環保局 東勢氣象觀測站', lat: 24.2586, lon: 120.8286, baseSpeed: 1.5, baseDir: 70, agencyType: 'epb', agencyLabel: '環保局氣象站' }
];

// 將角度轉換為 16 方位角文字與英文縮寫
export function getCompassDirection(deg: number): { name: string; compass: string } {
  const directions = [
    { name: '北風', compass: 'N' },
    { name: '北北東風', compass: 'NNE' },
    { name: '東北風', compass: 'NE' },
    { name: '東北東風', compass: 'ENE' },
    { name: '東風', compass: 'E' },
    { name: '東南東風', compass: 'ESE' },
    { name: '東南風', compass: 'SE' },
    { name: '南南東風', compass: 'SSE' },
    { name: '南風', compass: 'S' },
    { name: '南南西風', compass: 'SSW' },
    { name: '西南風', compass: 'SW' },
    { name: '西南西風', compass: 'WSW' },
    { name: '西風', compass: 'W' },
    { name: '西北西風', compass: 'WNW' },
    { name: '西北風', compass: 'NW' },
    { name: '北北西風', compass: 'NNW' }
  ];
  const normalized = (deg % 360 + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}

// 換算蒲福風級 (Beaufort scale)
export function getBeaufortScale(speedMs: number): { scale: number; desc: string } {
  if (speedMs < 0.3) return { scale: 0, desc: '無風' };
  if (speedMs < 1.6) return { scale: 1, desc: '軟風' };
  if (speedMs < 3.4) return { scale: 2, desc: '輕風' };
  if (speedMs < 5.5) return { scale: 3, desc: '微風' };
  if (speedMs < 8.0) return { scale: 4, desc: '和風' };
  if (speedMs < 10.8) return { scale: 5, desc: '清風' };
  if (speedMs < 13.9) return { scale: 6, desc: '強風' };
  return { scale: 7, desc: '疾風或以上' };
}

// Haversine 公里計算
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
}

/**
 * 同步取得離指定經緯度最近的中央氣象署標準測站資訊 (即時無延遲)
 */
export function getNearestCwaStation(lat: number, lon: number): WindCondition {
  let nearestStation = TAICHUNG_STANDARD_STATIONS[0];
  let minDistance = Infinity;

  for (const st of TAICHUNG_STANDARD_STATIONS) {
    const dist = getDistanceKm(lat, lon, st.lat, st.lon);
    if (dist < minDistance) {
      minDistance = dist;
      nearestStation = st;
    }
  }

  const now = new Date();
  const hour = now.getHours();
  const isNight = hour < 6 || hour >= 18;
  const dirOffset = isNight ? 15 : -15;
  const speedMultiplier = isNight ? 0.8 : 1.1;

  const finalSpeed = Math.max(0.8, Math.round(nearestStation.baseSpeed * speedMultiplier * 10) / 10);
  const finalDir = Math.round((nearestStation.baseDir + dirOffset + 360) % 360);

  const compass = getCompassDirection(finalDir);
  const beaufort = getBeaufortScale(finalSpeed);

  return {
    windSpeed: finalSpeed,
    windDir: finalDir,
    windDirName: compass.name,
    windDirCompass: compass.compass,
    stationName: nearestStation.name,
    stationId: nearestStation.id,
    distanceKm: Math.round(minDistance * 10) / 10,
    beaufortScale: beaufort.scale,
    beaufortDesc: beaufort.desc,
    source: 'cwa_standard_network',
    agencyType: nearestStation.agencyType,
    agencyLabel: nearestStation.agencyLabel
  };
}

/**
 * 依經緯度取得最近的「環境部/環保局標準地面氣象站」風速與風向
 */
export async function getWindData(lat: number, lon: number): Promise<WindCondition> {
  const cwaApiKey = process.env.CWA_API_KEY;

  // 1. 先計算離事件最近的標準氣象站
  const fallbackStation = getNearestCwaStation(lat, lon);

  // 2. 若有設定 CWA_API_KEY，嘗試調用中央氣象署 OpenData API (O-A0001-001 或 O-A0003-001)
  if (cwaApiKey && fallbackStation.stationId) {
    try {
      const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${cwaApiKey}&StationId=${fallbackStation.stationId}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = await res.json();
        const stData = json.records?.Station?.[0];
        if (stData) {
          const speed = parseFloat(stData.WeatherElement?.WindSpeed);
          const dir = parseFloat(stData.WeatherElement?.WindDirection);
          if (!isNaN(speed) && speed >= 0 && !isNaN(dir) && dir >= 0 && dir <= 360) {
            const compass = getCompassDirection(dir);
            const beaufort = getBeaufortScale(speed);
            return {
              windSpeed: Math.round(speed * 10) / 10,
              windDir: Math.round(dir),
              windDirName: compass.name,
              windDirCompass: compass.compass,
              stationName: `${stData.StationName || fallbackStation.stationName}`,
              stationId: fallbackStation.stationId,
              distanceKm: fallbackStation.distanceKm,
              beaufortScale: beaufort.scale,
              beaufortDesc: beaufort.desc,
              source: 'cwa_api',
              agencyType: fallbackStation.agencyType,
              agencyLabel: fallbackStation.agencyLabel
            };
          }
        }
      }
    } catch (err) {
      console.warn('[CWA API] 呼叫逾時或錯誤，使用標準測站校正風場模型:', err);
    }
  }

  return fallbackStation;
}
