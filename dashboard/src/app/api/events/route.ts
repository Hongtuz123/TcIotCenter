import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { globalMockState } from '@/lib/mockData';

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

export async function GET() {
  try {
    // ── Tier 1: Supabase（Vercel 線上環境）─────────────────────────────────────
    if (supabase) {
      const client = supabase;
      const { data, error } = await client
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        if (error.message?.includes('does not exist')) {
          return NextResponse.json([]);
        }
        throw error;
      }

      // 淨化事件標題，移除 [白數]、[自動]、[自定義] 前綴，維護乾淨命名與原始檔名
      const sanitizedData = (data || []).map((ev: any) => {
        if (ev.title) {
          const cleanTitle = ev.title.replace(/^\[(自動|自定義|白數)\]\s*/g, '').replace(/^事件管理-?/g, '');
          if (cleanTitle !== ev.title) {
            (async () => {
              try { await client.from('events').update({ title: cleanTitle }).eq('id', ev.id); } catch (e) {}
            })();
            return { ...ev, title: cleanTitle };
          }
        }
        return ev;
      });

      // 取得所有事件的 unique event_time 以一次性查詢感測值，避免 N+1 查詢問題
      const uniqueTimes = Array.from(new Set(sanitizedData.map((ev: any) => ev.event_time).filter(Boolean)));
      let allObs: any[] = [];
      if (uniqueTimes.length > 0) {
        const { data: obsData, error: obsErr } = await client
          .from('observations_5m')
          .select(`
            station_id,
            bucket_time,
            pm2_5,
            temperature,
            humidity,
            sensors!inner(device_name, lat, lon, township, area)
          `)
          .in('bucket_time', uniqueTimes);
        
        if (!obsErr && obsData) {
          allObs = obsData;
        }
      }

      // 將觀測值依 bucket_time 毫秒時間戳分組
      const obsByTimeMap = new Map<number, any[]>();
      for (const row of allObs) {
        const ts = new Date(row.bucket_time).getTime();
        if (!obsByTimeMap.has(ts)) {
          obsByTimeMap.set(ts, []);
        }
        obsByTimeMap.get(ts)!.push(row);
      }

      // 解析 bounds JSON 並動態過濾落在該 radiusKm 內的所有感測站資料 (補齊 sensors)
      const events = (data || []).map((ev: any) => {
        const parsedBounds = typeof ev.bounds === 'string' ? (() => { try { return JSON.parse(ev.bounds); } catch { return ev.bounds; } })() : ev.bounds;
        const eventTs = ev.event_time ? new Date(ev.event_time.replace(' ', 'T')).getTime() : 0;
        const obsList = obsByTimeMap.get(eventTs) || [];
        
        let sensors: any[] = [];
        if (parsedBounds && parsedBounds.center && obsList.length > 0) {
          const lat = parsedBounds.center.lat;
          const lon = parsedBounds.center.lon !== undefined ? parsedBounds.center.lon : parsedBounds.center.lng;
          const radiusKm = parsedBounds.radiusKm ?? 1.0;
          
          if (lat !== undefined && lon !== undefined) {
            sensors = obsList
              .filter(obs => {
                const sLat = obs.sensors?.lat;
                const sLon = obs.sensors?.lon;
                if (sLat === undefined || sLon === undefined) return false;
                return getDistanceKm(lat, lon, sLat, sLon) <= radiusKm;
              })
              .map(obs => ({
                id: obs.station_id,
                name: obs.sensors?.device_name || obs.station_id,
                lat: obs.sensors?.lat || 0,
                lon: obs.sensors?.lon || 0,
                county: obs.sensors?.township || '臺中市',
                status: '正常',
                pm2_5: obs.pm2_5,
                temperature: obs.temperature,
                humidity: obs.humidity,
                voc: null
              }));
          }
        }

        return {
          ...ev,
          bounds: parsedBounds,
          sensors
        };
      });

      return NextResponse.json(events);
    }

    // ── Tier 2: SQLite（本地開發環境）─────────────────────────────────────────
    const db = await getDb();
    if (!db) {
      // 降級為 Mock
      return NextResponse.json(globalMockState.events);
    }

    // 獲取所有事件
    const events = await db.all('SELECT * FROM events ORDER BY created_at DESC');
    
    // 獲取每個事件關聯的感測器（包含當時測值）
    for (const event of events) {
      const sensors = await db.all(`
        SELECT s.id, s.name, s.lat, s.lon, s.county, s.status, es.pm25 AS pm2_5, es.temperature, es.humidity, es.voc
        FROM event_sensors es
        JOIN sensors s ON es.sensor_id = s.id
        WHERE es.event_id = ?
      `, [event.id]);
      
      if (event.bounds) {
        try {
          event.bounds = JSON.parse(event.bounds);
        } catch {
          // 保持字串
        }
      }
      
      event.sensors = sensors;
    }
    
    return NextResponse.json(events);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, status, bounds, event_time, sensors } = body;

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    const eventId = `event_${Date.now()}`;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // ── Tier 1: Supabase（Vercel 線上環境）─────────────────────────────────────
    if (supabase) {
      const client = supabase;
      const { error } = await client.from('events').insert({
        id: eventId,
        title,
        description: description || '',
        status: status || '待確認',
        created_at: nowStr,
        updated_at: nowStr,
        bounds: bounds ? JSON.stringify(bounds) : null,
        event_time: event_time || null,
        stations_count: Array.isArray(sensors) ? sensors.length : 0,
        avg_pm25: Array.isArray(sensors) && sensors.length > 0 
          ? sensors.reduce((acc: number, s: any) => acc + (s.pm2_5 || 0), 0) / sensors.length 
          : null,
        dominant_type: '手動新增事件'
      });

      if (error) {
        throw error;
      }
      return NextResponse.json({ success: true, id: eventId });
    }

    const db = await getDb();

    if (!db) {
      // 降級為 Mock 並在記憶體中建立
      const newEvent = {
        id: eventId,
        title,
        description: description || '',
        status: status || '待確認',
        created_at: nowStr,
        updated_at: nowStr,
        event_time: event_time || null,
        bounds: bounds || null,
        sensors: sensors || []
      };
      globalMockState.events.unshift(newEvent as any);
      return NextResponse.json({ success: true, id: eventId });
    }

    await db.run('BEGIN TRANSACTION');

    try {
      await db.run(`
        INSERT INTO events (id, title, description, status, created_at, updated_at, bounds, event_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        eventId,
        title,
        description || '',
        status || '待確認',
        nowStr,
        nowStr,
        bounds ? JSON.stringify(bounds) : null,
        event_time || null
      ]);

      if (Array.isArray(sensors)) {
        for (const s of sensors) {
          await db.run(`
            INSERT OR IGNORE INTO event_sensors (event_id, sensor_id, pm25, temperature, humidity, voc)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [eventId, s.id, s.pm2_5 ?? null, s.temperature ?? null, s.humidity ?? null, s.voc ?? null]);
        }
      }

      await db.run('COMMIT');
      return NextResponse.json({ success: true, id: eventId });
    } catch (txError) {
      await db.run('ROLLBACK');
      throw txError;
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

