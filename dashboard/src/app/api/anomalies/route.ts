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
    // 捕捉至區域變數，讓 TypeScript 在 Promise.all 閉包內正確縮窄型別（non-null）
    const client = supabase;
    await Promise.all(clusters.map(async (cluster) => {
      const lat = cluster.center.lat;
      const lon = cluster.center.lon;
      const fmtTime = timeStr.replace(/[- :T]/g, '').substring(0, 12);
      const eventId = `auto_${fmtTime}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
      const dominantType =
        cluster.dominantType && cluster.dominantType !== '--' && cluster.dominantType !== 'undefined'
          ? cluster.dominantType
          : '微感超標-群聚';

      try {
        const { error } = await client.from('events').upsert({
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
          if (!error.message?.includes('does not exist')) {
            console.error('Supabase 自動寫入事件錯誤:', error.message);
          }
        }
      } catch (e) {
        console.error('autoCreateEvents Supabase 例外:', e);
      }
    }));
    return; // Supabase 模式完成，不繼續往下
  }

  // ── Tier 2: SQLite（本地開發環境）─────────────────────────────────────────
  const db = await getDb();
  if (db) {
    await Promise.all(clusters.map(async (cluster) => {
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

        await Promise.all(cluster.stations.map((station: any) =>
          db.run(`
            INSERT OR IGNORE INTO event_sensors (event_id, sensor_id, pm25)
            VALUES (?, ?, ?)
          `, [eventId, station.id, station.pm2_5])
        ));
      } catch (e) {
        console.error('自動寫入事件錯誤:', e);
      }
    }));
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
      // 讀取設定中的 consecutive_exceeds
      let consecutiveExceeds = 3;
      try {
        const { data: setRows } = await supabase.from('settings').select('*');
        const setObj = setRows?.reduce((acc: any, r: any) => {
          acc[r.key] = parseFloat(r.value);
          return acc;
        }, {});
        if (setObj && setObj.consecutive_exceeds !== undefined) {
          consecutiveExceeds = parseInt(setObj.consecutive_exceeds, 10);
        }
      } catch (e) {}

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
          // 將 window 窗口設為能包含 N 筆的範圍，多給 5 分鐘緩衝
          since = new Date(d.getTime() - consecutiveExceeds * 5 * 60 * 1000).toISOString(); 
        }
      }

      // 用 Map 記錄每個測站的觀測值列表
      const stationObsListMap = new Map<string, any[]>();
      let from = 0;
      const client = supabase;
      while (true) {
        const { data: obsPage, error: obsErr } = await client
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

        for (const row of obsPage) {
          if (!stationObsListMap.has(row.station_id)) {
            stationObsListMap.set(row.station_id, []);
          }
          stationObsListMap.get(row.station_id)!.push(row);
        }
        if (obsPage.length < 1000) break;
        from += 1000;
      }

      const allPoints = Array.from(stationObsListMap.keys()).map((stationId) => {
        const obsList = stationObsListMap.get(stationId)!;
        // 已按 bucket_time 降序排序，所以第一筆就是最新的一筆作為代表
        const latestRow = obsList[0];
        const sensor = (latestRow as any).sensors;
        const pm25 = latestRow.pm2_5;
        
        // 判定是否連續 N 筆超標
        let isAnomaly = false;
        if (obsList.length >= consecutiveExceeds) {
          const checkSlice = obsList.slice(0, consecutiveExceeds);
          isAnomaly = checkSlice.every((row) => row.pm2_5 != null && row.pm2_5 >= pm25Thresh);
        }

        const anomalyType = isAnomaly ? `連續 ${consecutiveExceeds} 筆 PM₂.₅ 超標` : '';

        return {
          id: latestRow.station_id,
          name: sensor?.device_name || latestRow.station_id,
          lat: sensor?.lat || 0,
          lon: sensor?.lon || 0,
          county: sensor?.township || '臺中市',
          sensor_id: latestRow.station_id,
          time: latestRow.bucket_time,
          pm2_5: pm25,
          temperature: latestRow.temperature,
          humidity: latestRow.humidity,
          voc: null,
          isAnomaly,
          anomalyType,
          score: (pm25 || 0) * 0.5,
          status: '正常',
        };
      });

      const anomalies = allPoints.filter((p) => p.isAnomaly);
      const clusters = buildClusters(anomalies, clusterRadius, minStations);

      // 背景寫入事件（fire-and-forget），不阻塞 API response
      autoCreateEvents(clusters, time || new Date().toISOString().replace('T', ' ').substring(0, 19), pm25Thresh);

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
      const _consecutive = parseInt(settings.consecutive_exceeds || '3', 10);

      const dateObj = new Date(time.replace(' ', 'T'));
      const startTimeObj = new Date(dateObj.getTime() - _consecutive * 5 * 60 * 1000);
      const startTimeStr = startTimeObj.toISOString().replace('T', ' ').substring(0, 19);

      const records = await db.all(
        `SELECT s.id, s.name, s.lat, s.lon, s.county,
                o.pm2_5, o.time, o.temperature, o.humidity, o.voc
         FROM sensors s
         JOIN observations o ON s.id = o.sensor_id
         WHERE o.time BETWEEN ? AND ?`,
        [startTimeStr, time]
      );

      // 按 sensor_id 分組
      const groups: Record<string, any[]> = {};
      for (const r of records) {
        if (!groups[r.id]) {
          groups[r.id] = [];
        }
        groups[r.id].push(r);
      }

      const allPoints = Object.keys(groups).map((sensorId) => {
        const obsList = groups[sensorId];
        // 按時間降序排序（最新在最前）
        obsList.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

        const latest = obsList[0];
        
        let isAnomaly = false;
        if (obsList.length >= _consecutive) {
          const checkSlice = obsList.slice(0, _consecutive);
          isAnomaly = checkSlice.every((r) => r.pm2_5 != null && r.pm2_5 >= _pm25Thresh);
        }

        const anomalyType = isAnomaly ? `連續 ${_consecutive} 筆 PM₂.₅ 超標` : '';

        return {
          id: latest.id,
          name: latest.name,
          lat: latest.lat,
          lon: latest.lon,
          county: latest.county,
          sensor_id: latest.id,
          time: latest.time,
          pm2_5: latest.pm2_5,
          temperature: latest.temperature,
          humidity: latest.humidity,
          voc: latest.voc,
          isAnomaly,
          anomalyType,
          score: (latest.pm2_5 || 0) * 0.5,
          status: '正常'
        };
      });

      const anomalies = allPoints.filter((p: any) => p.isAnomaly);
      const clusters = buildClusters(anomalies, _clusterRadius, _minStations);

      // 背景寫入事件（fire-and-forget），不阻塞 API response
      autoCreateEvents(clusters, time, _pm25Thresh);

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

    // 背景寫入事件（fire-and-forget），不阻塞 API response
    autoCreateEvents(clusters, mockTime, pm25Thresh);

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
