/**
 * 中央氣象署 (CWA) 開放資料 API 串接與風場資料模組
 */

export interface WindCondition {
  windSpeed: number; // 風速 (m/s)
  windDir: number;   // 風向 (角度，0-360 度，北風為 0/360，東風為 90)
  stationName?: string;
  source: 'cwa_api' | 'mock_fallback';
}

/**
 * 根據經緯度取得最近的氣象觀測風速與風向
 * @param lat 緯度
 * @param lon 經度
 */
export async function getWindData(lat: number, lon: number): Promise<WindCondition> {
  const cwaApiKey = process.env.CWA_API_KEY;

  if (cwaApiKey) {
    try {
      // 氣象署「自動氣象站-氣象觀測資料」API (O-A0003-001)
      const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization=${cwaApiKey}&limit=50`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) }); // 3秒超時
      
      if (res.ok) {
        const json = await res.json();
        const stationList = json.records?.Station || [];
        
        let nearestStation: any = null;
        let minDistanceSq = Infinity;

        // 尋找最近的觀測站
        for (const st of stationList) {
          const stLat = st.GeoInfo?.Coordinates?.CoordinateLat;
          const stLon = st.GeoInfo?.Coordinates?.CoordinateLon;
          const wSpeed = st.WeatherElement?.WindSpeed;
          const wDir = st.WeatherElement?.WindDirection;

          if (stLat && stLon && wSpeed !== undefined && wDir !== undefined) {
            const distSq = Math.pow(stLat - lat, 2) + Math.pow(stLon - lon, 2);
            if (distSq < minDistanceSq) {
              minDistanceSq = distSq;
              nearestStation = st;
            }
          }
        }

        if (nearestStation) {
          const speed = parseFloat(nearestStation.WeatherElement.WindSpeed);
          const dir = parseFloat(nearestStation.WeatherElement.WindDirection);

          // CWA 的風速風向可能回傳 -99 或異常值，需予以過濾
          if (!isNaN(speed) && speed >= 0 && !isNaN(dir) && dir >= 0 && dir <= 360) {
            return {
              windSpeed: speed,
              windDir: dir,
              stationName: nearestStation.StationName || nearestStation.StationId,
              source: 'cwa_api'
            };
          }
        }
      }
    } catch (err) {
      console.warn('CWA API fetch failed, falling back to mock wind data:', err);
    }
  }

  // ── Mock Fallback 邏輯（與 SensorMap 的地理演算法對齊，以保證一致性） ─────────────────
  let windSpeed = 1.8;
  let windDir = 240; // 預設西南西風

  // 簡單的經度演算法模擬海線/山區風場差異
  if (lon < 120.55) {
    // 海線：風速大，北風或西北風偏多
    windSpeed = 3.5;
    windDir = 330;
  } else if (lon > 120.70) {
    // 山區：風速小，多山谷地形偏向風
    windSpeed = 1.0;
    windDir = 120;
  } else {
    // 平原盆地：偏西南西風
    windSpeed = 1.8;
    windDir = 240;
  }

  return {
    windSpeed,
    windDir,
    stationName: '模擬虛擬氣象站',
    source: 'mock_fallback'
  };
}
