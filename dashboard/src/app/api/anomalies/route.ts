import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { getMockObservations, globalMockState } from '@/lib/mockData';

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

function buildClusters(anomalies: any[], clusterRadius: number, minStations: number) {
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
        id: `cluster_${anomaly.id}`,
        center: { lat: avgLat, lon: avgLon },
        radiusKm: clusterRadius,
        stationsCount: group.length,
        avgPm25,
        maxScore,
        dominantType: mostCommonType,
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

    const pm25Thresh = 54;
    const clusterRadius = 1.0;
    const minStations = 2;

    // ── Tier 1: Supabase ──────────────────────────────────────────────────────
    if (supabase) {
      // 取最新 5 分鐘桶的所有站資料（latest bucket within 30 min）
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

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
          sensors!inner(device_name, lat, lon, township, area)
        `)
        .gte('bucket_time', since)
        .order('bucket_time', { ascending: false });

      if (obsErr) throw obsErr;

      // 每站只取最新一筆
      const latestMap = new Map<string, any>();
      for (const row of (obsData || [])) {
        if (!latestMap.has(row.station_id)) {
          latestMap.set(row.station_id, row);
        }
      }

      const allPoints = Array.from(latestMap.values()).map((row) => {
        const sensor = (row as any).sensors;
        const pm25 = row.pm2_5;
        const isAnomaly = pm25 != null && pm25 >= pm25Thresh;
        return {
          id: row.station_id,
          name: sensor?.device_name || row.station_id,
          lat: sensor?.lat || 0,
          lon: sensor?.lon || 0,
          county: sensor?.township || '臺中市',
          sensor_id: row.station_id,
          time: row.bucket_time,
          pm2_5: pm25,
          temperature: row.temperature,
          humidity: row.humidity,
          voc: null,
          isAnomaly: row.is_anomaly || isAnomaly,
          anomalyType: row.anomaly_type || '',
          score: (pm25 || 0) * 0.5,
          status: '正常',
        };
      });

      const anomalies = allPoints.filter((p) => p.isAnomaly);
      const clusters = buildClusters(anomalies, clusterRadius, minStations);

      return NextResponse.json({
        time: time || new Date().toISOString(),
        mode: 'supabase_realtime',
        points: allPoints,
        anomaliesCount: anomalies.length,
        clusters,
        settings: { pm25Thresh, clusterRadius, minStations },
      });
    }

    // ── Tier 2: SQLite ────────────────────────────────────────────────────────
    const db = await getDb();
    if (db && time) {
      const settingsRows = await db.all('SELECT * FROM settings');
      const settings = settingsRows.reduce((acc: any, row: any) => {
        acc[row.key] = parseFloat(row.value);
        return acc;
      }, {});
      const _pm25Thresh = settings.pm25_threshold || 54.0;
      const _clusterRadius = settings.cluster_radius_km || 1.0;
      const _minStations = settings.min_cluster_stations || 2;

      const dateObj = new Date(time.replace(' ', 'T'));
      dateObj.setMinutes(dateObj.getMinutes() - 15);
      const prevTime = dateObj.toISOString().replace('T', ' ').substring(0, 19);

      const records = await db.all(
        `SELECT s.id, s.name, s.lat, s.lon, s.county,
                o.pm2_5, o.temperature, o.humidity, o.voc,
                prev.temperature AS prev_temperature
         FROM sensors s
         JOIN observations o ON s.id = o.sensor_id AND o.time = ?
         LEFT JOIN observations prev ON s.id = prev.sensor_id AND prev.time = ?`,
        [time, prevTime]
      );

      const allPoints = records.map((r: any) => {
        const tempDiff = r.prev_temperature ? r.temperature - r.prev_temperature : 0;
        const isPm25Anomaly = r.pm2_5 >= _pm25Thresh;
        const isVocAnomaly = r.voc >= (settings.voc_threshold || 1.5);
        const isTempAnomaly = tempDiff >= (settings.temp_increase_threshold || 3);
        const isAnomaly = isPm25Anomaly || isVocAnomaly || isTempAnomaly;
        let anomalyType = '';
        if (isAnomaly) {
          if (isVocAnomaly && isPm25Anomaly) anomalyType = '疑似工廠排污';
          else if (isTempAnomaly && isPm25Anomaly) anomalyType = '疑似露天燃燒';
          else anomalyType = '數值異常';
        }
        return { ...r, sensor_id: r.id, time, tempDiff, isAnomaly, anomalyType, score: (r.pm2_5 || 0) * 0.5 + (r.voc || 0) * 20 + tempDiff * 10 };
      });

      const anomalies = allPoints.filter((p: any) => p.isAnomaly);
      return NextResponse.json({
        time,
        mode: 'sqlite',
        points: allPoints,
        anomaliesCount: anomalies.length,
        clusters: buildClusters(anomalies, _clusterRadius, _minStations),
        settings: { pm25Thresh: _pm25Thresh, clusterRadius: _clusterRadius, minStations: _minStations },
      });
    }

    // ── Tier 3: Mock ──────────────────────────────────────────────────────────
    const mockTime = time || new Date().toISOString();
    const allPoints = getMockObservations(mockTime);
    const anomalies = allPoints.filter((p) => p.isAnomaly);
    return NextResponse.json({
      time: mockTime,
      mode: 'mock',
      points: allPoints,
      anomaliesCount: anomalies.length,
      clusters: buildClusters(anomalies as any[], clusterRadius, minStations),
      settings: { pm25Thresh, clusterRadius, minStations },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
