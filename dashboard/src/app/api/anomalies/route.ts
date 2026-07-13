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

async function autoCreateEvents(clusters: any[], timeStr: string, pm25Thresh: number) {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // ── Tier 1: Supabase（Vercel 線上環境）─────────────────────────────────────
  if (supabase && clusters.length > 0) {
    for (const cluster of clusters) {
      const lat = cluster.center.lat;
      const lon = cluster.center.lon;
      const fmtTime = timeStr.replace(/[- :T]/g, '').substring(0, 12);
      const eventId = `auto_${fmtTime}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
      const dominantType =
        cluster.dominantType && cluster.dominantType !== '--' && cluster.dominantType !== 'undefined'
          ? cluster.dominantType
          : '微感超標-群聚';

      try {
        const { error } = await supabase.from('events').upsert({
          id: eventId,
          title: `[自動] 微感超標群聚事件 (門檻: PM₂.₅ ${pm25Thresh})`,
          description: `系統自動偵測超標群聚熱區。超標站數：${cluster.stationsCount} 站，平均 PM₂.₅ 濃度：${cluster.avgPm25.toFixed(1)} µg/m³，主導類型：${dominantType}。`,
          status: '待確認',
          created_at: nowStr,
          updated_at: nowStr,
          bounds: JSON.stringify({ center: { lat, lng: lon }, radiusKm: cluster.radiusKm }),
          event_time: timeStr,
          stations_count: cluster.stationsCount,
          avg_pm25: cluster.avgPm25,
          dominant_type: dominantType,
        }, { onConflict: 'id', ignoreDuplicates: true });

        if (error) {
          // 若 events 資料表不存在，靜默略過
          if (!error.message?.includes('does not exist')) {
            console.error('Supabase 自動寫入事件錯誤:', error.message);
          }
        }
      } catch (e) {
        console.error('autoCreateEvents Supabase 例外:', e);
      }
    }
    return; // Supabase 模式完成，不繼續往下
  }

  // ── Tier 2: SQLite（本地開發環境）─────────────────────────────────────────
  const db = await getDb();
  if (db) {
    for (const cluster of clusters) {
      const lat = cluster.center.lat;
      const lon = cluster.center.lon;
      const fmtTime = timeStr.replace(/[- :T]/g, '').substring(0, 12);
      const eventId = `auto_${fmtTime}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
      const title = `[自動] 微感超標群聚事件 (門檻: PM₂.₅ ${pm25Thresh})`;
      const description = `系統自動偵測超標群聚熱區。超標站數：${cluster.stationsCount} 站，平均 PM₂.₅ 濃度：${cluster.avgPm25.toFixed(1)} µg/m³，主導類型：${cluster.dominantType && cluster.dominantType !== '--' && cluster.dominantType !== 'undefined' ? cluster.dominantType : '微感超標-群聚'}。`;
      const boundsJson = JSON.stringify({ center: { lat, lng: lon }, radiusKm: cluster.radiusKm });

      try {
        await db.run(`
          INSERT OR IGNORE INTO events (id, title, description, status, created_at, updated_at, bounds, event_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [eventId, title, description, '待確認', nowStr, nowStr, boundsJson, timeStr]);

        for (const station of cluster.stations) {
          await db.run(`
            INSERT OR IGNORE INTO event_sensors (event_id, sensor_id, pm25)
            VALUES (?, ?, ?)
          `, [eventId, station.id, station.pm2_5]);
        }
      } catch (e) {
        console.error('自動寫入事件錯誤:', e);
      }
    }
    return;
  }

  // ── Tier 3: Mock（無資料庫降級模式）──────────────────────────────────────
  for (const cluster of clusters) {
    const lat = cluster.center.lat;
    const lon = cluster.center.lon;
    const fmtTime = timeStr.replace(/[- :T]/g, '').substring(0, 12);
    const eventId = `auto_${fmtTime}_${lat.toFixed(3)}_${lon.toFixed(3)}`;

    const exists = globalMockState.events.some((ev) => ev.id === eventId);
    if (!exists) {
      globalMockState.events.unshift({
        id: eventId,
        title: `[自動] 微感超標群聚事件 (門檻: PM₂.₅ ${pm25Thresh})`,
        description: `系統自動偵測超標群聚熱區。超標站數：${cluster.stationsCount} 站，平均 PM₂.₅ 濃度：${cluster.avgPm25.toFixed(1)} µg/m³。`,
        status: '待確認' as const,
        created_at: nowStr,
        updated_at: nowStr,
        event_time: timeStr,
        bounds: { center: { lat, lng: lon }, radiusKm: cluster.radiusKm },
        sensors: cluster.stations.map((s: any) => ({ id: s.id, name: s.name, pm2_5: s.pm2_5 }))
      } as any);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const time = searchParams.get('time');

    const pm25Thresh = parseFloat(searchParams.get('pm25_threshold') || '54');
    const clusterRadius = parseFloat(searchParams.get('radius') || '1.0');
    const minStations = parseInt(searchParams.get('min_stations') || '2', 10);

    // ── Tier 1: Supabase ──────────────────────────────────────────────────────
    if (supabase) {
      let until = new Date().toISOString();
      let since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      if (time) {
        let normalizedTime = time.replace('T', ' ').replace(/\//g, '-');
        if (!normalizedTime.includes('+') && !normalizedTime.includes('Z') && !normalizedTime.includes('GMT')) {
          normalizedTime = normalizedTime.trim() + '+08:00';
        }
        const d = new Date(normalizedTime);
        if (!isNaN(d.getTime())) {
          until = d.toISOString();
          since = new Date(d.getTime() - 15 * 60 * 1000).toISOString(); // 歷史模式窗口取 15 分鐘
        }
      }

      // 分頁迴圈抓取，突破 Supabase max_rows=1000 限制
      const latestMap = new Map<string, any>();
      let from = 0;
      while (true) {
        const { data: obsPage, error: obsErr } = await supabase
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
          .lte('bucket_time', until)
          .order('bucket_time', { ascending: false })
          .range(from, from + 999);

        if (obsErr) throw obsErr;
        if (!obsPage || obsPage.length === 0) break;

        // 每站只保留最新一筆
        for (const row of obsPage) {
          if (!latestMap.has(row.station_id)) {
            latestMap.set(row.station_id, row);
          }
        }
        if (obsPage.length < 1000) break;
        from += 1000;
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

      // 自動將達到門檻的熱區轉換成事件寫入資料庫
      await autoCreateEvents(clusters, time || new Date().toISOString().replace('T', ' ').substring(0, 19), pm25Thresh);

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
        
        // 核心修正：必須 PM2.5 先超標，此點才能算是異常，此時才連帶去判斷溫濕度（及VOC）是否有一起超標
        const isAnomaly = isPm25Anomaly;

        let anomalyType = '';
        if (isAnomaly) {
          if (isVocAnomaly) anomalyType = '疑似工廠排污';
          else if (isTempAnomaly) anomalyType = '疑似露天燃燒';
          else anomalyType = '數值異常';
        }
        return { ...r, sensor_id: r.id, time, tempDiff, isAnomaly, anomalyType, score: (r.pm2_5 || 0) * 0.5 + (r.voc || 0) * 20 + tempDiff * 10 };
      });

      const anomalies = allPoints.filter((p: any) => p.isAnomaly);
      const clusters = buildClusters(anomalies, _clusterRadius, _minStations);

      // 自動將達到門檻的熱區轉換成事件寫入資料庫
      await autoCreateEvents(clusters, time, _pm25Thresh);

      return NextResponse.json({
        time,
        mode: 'sqlite',
        points: allPoints,
        anomaliesCount: anomalies.length,
        clusters,
        settings: { pm25Thresh: _pm25Thresh, clusterRadius: _clusterRadius, minStations: _minStations },
      });
    }

    // ── Tier 3: Mock ──────────────────────────────────────────────────────────
    const mockTime = time || new Date().toISOString();
    const allPoints = getMockObservations(mockTime);
    const anomalies = allPoints.filter((p) => p.isAnomaly);
    const clusters = buildClusters(anomalies as any[], clusterRadius, minStations);

    // 自動將達到門檻的熱區轉換成事件寫入資料庫
    await autoCreateEvents(clusters, mockTime, pm25Thresh);

    return NextResponse.json({
      time: mockTime,
      mode: 'mock',
      points: allPoints,
      anomaliesCount: anomalies.length,
      clusters,
      settings: { pm25Thresh, clusterRadius, minStations },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
