import { Sensor, Observation, Event, Cluster, SystemSettings } from '@/types';

// Mock 測站基本資訊
export const mockSensors: Sensor[] = [
  { id: '11670353931', name: 'TC0307', lat: 24.078526, lon: 120.718681, county: '太平區', status: '正常' },
  { id: '11670494619', name: 'TC0117', lat: 24.217858, lon: 120.698324, county: '豐原區', status: '正常' },
  { id: '11670503038', name: 'TC0327', lat: 24.178219, lon: 120.747103, county: '北屯區', status: '正常' },
  { id: '11670626968', name: 'TC0118', lat: 24.196600, lon: 120.546950, county: '清水區', status: '正常' },
  { id: '11670903894', name: 'TC0096', lat: 24.133801, lon: 120.735630, county: '太平區', status: '正常' },
  { id: '11793620650', name: 'TC1385', lat: 24.169077, lon: 120.588177, county: '沙鹿區', status: '正常' }
];

// 記憶體中儲存的事件列表與設定值，支援 Vercel Demo 頁面即時操作
export const globalMockState = {
  events: [] as Event[],
  settings: {
    pm25_threshold: 54,
    temp_increase_threshold: 3,
    voc_threshold: 1.5,
    cluster_radius_km: 1.0,
    min_cluster_stations: 2
  } as SystemSettings
};

// 產生 Mock 的觀測值
export function getMockObservations(time: string): (Sensor & Observation)[] {
  // 將時間字串轉為 Hash 數值，讓同一時間的波動是固定的
  const timeHash = time.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

  return mockSensors.map((sensor, idx) => {
    // 依據測站與時間產生波動
    const basePm25 = 12 + (timeHash % 45) + (idx * 5);
    const temp = 22 + (timeHash % 8) + (idx * 0.5);
    const humidity = 70 + (timeHash % 25) - (idx * 2);
    
    // 特定幾個站點隨時間產生超標汙染
    const isStationAnomaly = (idx === 1 && timeHash % 3 === 0) || (idx === 5 && timeHash % 2 === 0);
    const pm25 = isStationAnomaly ? basePm25 + 40 : basePm25;
    const voc = isStationAnomaly ? 1.8 : 0.2;
    const tempDiff = isStationAnomaly ? 3.5 : 0.2;
    const temperature = isStationAnomaly ? temp + tempDiff : temp;

    const isPm25Anomaly = pm25 >= globalMockState.settings.pm25_threshold;
    const isVocAnomaly = voc >= globalMockState.settings.voc_threshold;
    const isTempAnomaly = tempDiff >= globalMockState.settings.temp_increase_threshold;
    const isAnomaly = isPm25Anomaly || isVocAnomaly || isTempAnomaly;

    let anomalyType = '';
    if (isAnomaly) {
      if (isVocAnomaly && isPm25Anomaly) anomalyType = '疑似工廠排汙';
      else if (isTempAnomaly && isPm25Anomaly) anomalyType = '疑似露天燃燒';
      else anomalyType = '數值異常';
    }

    return {
      ...sensor,
      sensor_id: sensor.id,
      time,
      pm2_5: Math.round(pm25),
      temperature: parseFloat(temperature.toFixed(1)),
      humidity: Math.round(humidity),
      voc: parseFloat(voc.toFixed(2)),
      tvoc: parseFloat((voc * 1.2).toFixed(2)),
      tempDiff: parseFloat(tempDiff.toFixed(1)),
      isAnomaly,
      anomalyType,
      score: pm25 * 0.5 + voc * 20 + tempDiff * 10
    };
  });
}

// 產生 Mock 歷史趨勢 (24 小時)
export function getMockHistory(sensorId: string, startTime: string): Observation[] {
  const sensor = mockSensors.find((s) => s.id === sensorId) || mockSensors[0];
  const history: Observation[] = [];
  
  // 建立 24 小時 (每 1 小時或每 15 分鐘一筆，為避免資料量過大使用每 15 分鐘一筆)
  const baseDate = startTime.substring(0, 10);
  
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const timeStr = `${baseDate} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
      // 正弦曲線波動
      const angle = (h / 24) * 2 * Math.PI;
      const pm25 = 20 + Math.sin(angle) * 15 + (sensorId === '11793620650' && h >= 10 && h <= 14 ? 65 : 0);
      const temp = 24 + Math.sin(angle) * 4;
      const humidity = 80 - Math.sin(angle) * 15;
      const voc = pm25 > 50 ? 1.6 : 0.3;

      history.push({
        sensor_id: sensor.id,
        time: timeStr,
        pm2_5: Math.round(pm25),
        temperature: parseFloat(temp.toFixed(1)),
        humidity: Math.round(humidity),
        voc: parseFloat(voc.toFixed(2)),
        tvoc: parseFloat((voc * 1.2).toFixed(2))
      });
    }
  }

  return history;
}
