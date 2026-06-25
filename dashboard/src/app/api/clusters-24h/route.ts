import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { getMockObservations } from '@/lib/mockData';

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

function buildClusters(anomalies: any[], clusterRadius: number, minStations: number, timeStr: string) {
  const clusters: any[] = [];
  const visited = new Set<string>();

  for (const anomaly of anomalies) {
    if (visited.has(anomaly.id)) continue;
    const group = anomalies.filter(
      (o) => getDistanceKm(anomaly.lat, anomaly.lon, o.lat, o.lon) <= clusterRadius
    );
    if (group.length >= minStations) {
      group.forEach((pt) => visited.add(pt.id));
      const avgLat = group.reduce((s, p) => s + p.lat, 0) / group.length;
      const avgLon = group.reduce((s, p) => s + p.lon, 0) / group.length;
      const avgPm25 = group.reduce((s, p) => s + (p.pm2_5 || 0), 0) / group.length;
      const maxScore = Math.max(...group.map((p) => p.score || 0));
      const types = group.map((p) => p.anomalyType);
      const mostCommonType = types.sort(
        (a, b) => types.filter((v) => v === a).length - types.filter((v) => v === b).length
      ).pop();
      clusters.push({
        id: `cluster_${timeStr.replace(/[- :]/g, '')}_${anomaly.id}`,
        time: timeStr,
        center: { lat: avgLat, lon: avgLon },
        radiusKm: clusterRadius,
        stationsCount: group.length,
        avgPm25,
        maxScore,
        dominantType: mostCommonType || '數值異常',
        stations: group.map((p) => ({ id: p.id, name: p.name, pm2_5: p.pm2_5 })),
      });
    }
  }
  return clusters;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const time = searchParams.get('time');
    
    // 優先從 URL 參數讀取閥值規則，實現 localStorage 同步
    const radius = parseFloat(searchParams.get('radius') || '1.0');
    const minStations = parseInt(searchParams.get('min_stations') || '2', 10);
    const pm25Thresh = parseFloat(searchParams.get('pm25_threshold') || '54');

    const allClusters: any[] = [];

    // ── Tier 1: Supabase ──────────────────────────────────────────────────────
    if (supabase) {
      const dateObj = time ? new Date(time.replace(' ', 'T')) : new Date();
      const timeEnd = dateObj.toISOString();
      const timeStart = new Date(dateObj.getTime() - 24 * 60 * 60 * 1000).toISOString();

      // 查過去 24 小時內的所有異常觀測
      const { data: obsData, error: obsErr } = await supabase
        .from('observations_5m')
        .select(`
          station_id,
          bucket_time,
          pm2_5,
          temperature,
          humidity,
          is_anomaly,
          anomaly_type,
          sensors!inner(device_name, lat, lon, township)
        `)
        .gte('bucket_time', timeStart)
        .lte('bucket_time', timeEnd)
        .eq('is_anomaly', true)
        .order('bucket_time', { ascending: true });

      if (obsErr) throw obsErr;

      // 按時間分桶聚合異常點
      const buckets: Record<string, any[]> = {};
      for (const row of (obsData || [])) {
        const bucketTime = row.bucket_time;
        if (!buckets[bucketTime]) {
          buckets[bucketTime] = [];
        }
        const sensor = (row as any).sensors;
        buckets[bucketTime].push({
          id: row.station_id,
          name: sensor?.device_name || row.station_id,
          lat: sensor?.lat || 0,
          lon: sensor?.lon || 0,
          county: sensor?.township || '臺中市',
          pm2_5: row.pm2_5,
          temperature: row.temperature,
          humidity: row.humidity,
          isAnomaly: true,
          anomalyType: row.anomaly_type || 'PM₂.₅超標',
          score: (row.pm2_5 || 0) * 0.5,
        });
      }

      // 對每個時間桶建立聚類
      for (const [bucketTime, anomalies] of Object.entries(buckets)) {
        const timeClusters = buildClusters(anomalies, radius, minStations, bucketTime);
        allClusters.push(...timeClusters);
      }
    }
    // ── Tier 2: SQLite ────────────────────────────────────────────────────────
    else {
      const db = await getDb();
      if (db && time) {
        const dateObj = new Date(time.replace(' ', 'T'));
        const timeEnd = time;
        const timeStartObj = new Date(dateObj.getTime() - 24 * 60 * 60 * 1000);
        const timeStart = timeStartObj.toISOString().replace('T', ' ').substring(0, 19);

        // 查過去 24 小時異常觀測
        const records = await db.all(
          `SELECT s.id, s.name, s.lat, s.lon, s.county,
                  o.pm2_5, o.time, o.temperature, o.humidity, o.voc
           FROM sensors s
           JOIN observations o ON s.id = o.sensor_id
           WHERE o.time BETWEEN ? AND ? AND o.pm2_5 >= ?`,
          [timeStart, timeEnd, pm25Thresh]
        );

        const buckets: Record<string, any[]> = {};
        for (const r of records) {
          const tStr = r.time;
          if (!buckets[tStr]) {
            buckets[tStr] = [];
          }
          buckets[tStr].push({
            id: r.id,
            name: r.name,
            lat: r.lat,
            lon: r.lon,
            county: r.county,
            pm2_5: r.pm2_5,
            temperature: r.temperature,
            humidity: r.humidity,
            isAnomaly: true,
            anomalyType: 'PM₂.₅超標',
            score: (r.pm2_5 || 0) * 0.5 + (r.voc || 0) * 20,
          });
        }

        for (const [tStr, anomalies] of Object.entries(buckets)) {
          const timeClusters = buildClusters(anomalies, radius, minStations, tStr);
          allClusters.push(...timeClusters);
        }
      }
      // ── Tier 3: Mock ────────────────────────────────────────────────────────
      else {
        // Mock 模式下，產生幾個假熱區
        const dateObj = time ? new Date(time.replace(' ', 'T')) : new Date();
        for (let i = 0; i < 3; i++) {
          const tPast = new Date(dateObj.getTime() - i * 30 * 60 * 1000);
          const tStr = tPast.toISOString().replace('T', ' ').substring(0, 19);
          allClusters.push({
            id: `cluster_mock_${i}`,
            time: tStr,
            center: { lat: 24.16 + i * 0.02, lon: 120.64 - i * 0.02 },
            radiusKm: radius,
            stationsCount: 3 + i,
            avgPm25: 65.5 - i * 5,
            maxScore: 30,
            dominantType: 'PM₂.₅超標',
            stations: [],
          });
        }
      }
    }

    // ── 每日重編流水號編碼邏輯 ────────────────────────────────────────────────
    // 按時間升序排序以生成正確的流水號順序
    allClusters.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    let currentDate = '';
    let seq = 0;
    for (const c of allClusters) {
      // 取得當地日期的日期字串 YYYY-MM-DD
      const dLocal = new Date(c.time);
      const year = dLocal.getFullYear();
      const month = String(dLocal.getMonth() + 1).padStart(2, '0');
      const day = String(dLocal.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      if (dateStr !== currentDate) {
        currentDate = dateStr;
        seq = 0;
      }
      seq++;

      const hours = String(dLocal.getHours()).padStart(2, '0');
      const minutes = String(dLocal.getMinutes()).padStart(2, '0');
      c.name = `${dateStr} ${hours}:${minutes} 污染熱區${seq}`;
    }

    // 最後將熱區按時間降序排序（讓最新發生的熱區排在最上面）
    allClusters.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return NextResponse.json(allClusters);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
