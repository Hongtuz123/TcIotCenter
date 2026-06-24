import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMockObservations, globalMockState } from '@/lib/mockData';

// 計算兩個經緯度之間的距離 (Haversine 公式)
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // 地球半徑 (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const time = searchParams.get('time'); // 例如 '2026-04-02 10:10:00'
    
    if (!time) {
      return NextResponse.json({ error: 'Missing time parameter' }, { status: 400 });
    }

    const db = await getDb();

    // 聲明設定變數與觀測點變數
    let pm25Thresh: number;
    let tempIncThresh: number;
    let vocThresh: number;
    let clusterRadius: number;
    let minStations: number;
    let allPoints: any[] = [];

    if (!db) {
      // 降級為 Mock，但依舊提供動態聚類計算！
      pm25Thresh = globalMockState.settings.pm25_threshold;
      tempIncThresh = globalMockState.settings.temp_increase_threshold;
      vocThresh = globalMockState.settings.voc_threshold;
      clusterRadius = globalMockState.settings.cluster_radius_km;
      minStations = globalMockState.settings.min_cluster_stations;

      // 直接使用記憶體運算產生的數據
      allPoints = getMockObservations(time);
    } else {
      // 1. 取得燃燒判定設定參數
      const settingsRows = await db.all('SELECT * FROM settings');
      const settings = settingsRows.reduce((acc: any, row) => {
        acc[row.key] = parseFloat(row.value);
        return acc;
      }, {});

      pm25Thresh = settings.pm25_threshold || 54.0;
      tempIncThresh = settings.temp_increase_threshold || 3.0;
      vocThresh = settings.voc_threshold || 1.5;
      clusterRadius = settings.cluster_radius_km || 1.0;
      minStations = settings.min_cluster_stations || 2;

      // 2. 獲取該時間點的所有觀測資料與測站座標
      const dateObj = new Date(time.replace(' ', 'T'));
      dateObj.setMinutes(dateObj.getMinutes() - 15);
      const prevTime = dateObj.toISOString().replace('T', ' ').substring(0, 19);

      const query = `
        SELECT 
          s.id, s.name, s.lat, s.lon, s.county,
          o.pm2_5, o.temperature, o.humidity, o.voc, o.tvoc,
          prev.temperature AS prev_temperature
        FROM sensors s
        JOIN observations o ON s.id = o.sensor_id AND o.time = ?
        LEFT JOIN observations prev ON s.id = prev.sensor_id AND prev.time = ?
      `;

      const records = await db.all(query, [time, prevTime]);

      // 3. 判斷各點是否異常
      allPoints = records.map((r: any) => {
        const tempDiff = r.prev_temperature ? r.temperature - r.prev_temperature : 0;
        
        const isPm25Anomaly = r.pm2_5 >= pm25Thresh;
        const isVocAnomaly = r.voc >= vocThresh;
        const isTempAnomaly = tempDiff >= tempIncThresh;
        
        const isAnomaly = isPm25Anomaly || isVocAnomaly || isTempAnomaly;

        let anomalyType = '';
        if (isAnomaly) {
          if (isVocAnomaly && isPm25Anomaly) anomalyType = '疑似工廠排污';
          else if (isTempAnomaly && isPm25Anomaly) anomalyType = '疑似露天燃燒';
          else anomalyType = '數值異常';
        }

        return {
          ...r,
          tempDiff,
          isAnomaly,
          anomalyType,
          score: (r.pm2_5 || 0) * 0.5 + (r.voc || 0) * 20 + tempDiff * 10
        };
      });
    }

    const anomalies = allPoints.filter(pt => pt.isAnomaly);


    // 4. 空間聚類 (Spatial Clustering) 找出熱點群組
    const clusters: any[] = [];
    const visited = new Set<string>();

    for (const anomaly of anomalies) {
      if (visited.has(anomaly.id)) continue;

      // 找出半徑範圍內的其他異常站點
      const group = anomalies.filter(
        (other) => getDistanceKm(anomaly.lat, anomaly.lon, other.lat, other.lon) <= clusterRadius
      );

      // 如果符合熱點數量門檻
      if (group.length >= minStations) {
        group.forEach((pt) => visited.add(pt.id));

        // 計算中心點及平均污染程度
        const avgLat = group.reduce((sum, pt) => sum + pt.lat, 0) / group.length;
        const avgLon = group.reduce((sum, pt) => sum + pt.lon, 0) / group.length;
        const avgPm25 = group.reduce((sum, pt) => sum + (pt.pm2_5 || 0), 0) / group.length;
        const maxScore = Math.max(...group.map((pt) => pt.score));

        // 主導的異常類型
        const types = group.map((pt) => pt.anomalyType);
        const mostCommonType = types.sort(
          (a, b) => types.filter((v) => v === a).length - types.filter((v) => v === b).length
        ).pop();

        clusters.push({
          id: `cluster_${anomaly.id}`,
          center: { lat: avgLat, lon: avgLon },
          radiusKm: clusterRadius,
          stationsCount: group.length,
          avgPm25,
          maxScore,
          dominantType: mostCommonType,
          stations: group.map((pt) => ({ id: pt.id, name: pt.name, pm2_5: pt.pm2_5 }))
        });
      }
    }

    return NextResponse.json({
      time,
      settings: {
        pm25Thresh,
        tempIncThresh,
        vocThresh,
        clusterRadius,
        minStations
      },
      points: allPoints,
      anomaliesCount: anomalies.length,
      clusters
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
