import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { globalMockState } from '@/lib/mockData';

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

      // 一次性歷史資料清理：將帶有行政區、舊格式或 "微感事件" 的 title 統一修改為無行政區的 "[自動] 事件管理"
      const oldEvents = (data || []).filter((ev: any) => ev.title && (ev.title.includes('微感超標群聚事件') || ev.title.includes('區-微感事件') || ev.title.includes('微感事件')));
      if (oldEvents.length > 0) {
        for (const ev of oldEvents) {
          const threshMatch = ev.title.match(/門檻: PM₂.₅ (\d+(\.\d+)?)/);
          const thresh = threshMatch ? threshMatch[1] : '54';
          const newTitle = `[自動] 事件管理 (門檻: PM₂.₅ ${thresh})`;
          
          await client.from('events').update({ title: newTitle }).eq('id', ev.id);
          ev.title = newTitle; // 同步更新當前 response 記憶體
        }
      }

      // 解析 bounds JSON
      const events = (data || []).map((ev: any) => ({
        ...ev,
        bounds: typeof ev.bounds === 'string' ? (() => { try { return JSON.parse(ev.bounds); } catch { return ev.bounds; } })() : ev.bounds,
        sensors: [] // Supabase 模式下感測器清單暫不 JOIN
      }));

      return NextResponse.json(events);
    }

    // ── Tier 2: SQLite（本地開發環境）─────────────────────────────────────────
    const db = await getDb();
    if (!db) {
      // 降級為 Mock
      return NextResponse.json(globalMockState.events);
    }
    
    // 一次性歷史資料清理（SQLite）
    const rawEvents = await db.all('SELECT * FROM events ORDER BY created_at DESC');
    const oldSQLiteEvents = rawEvents.filter((ev: any) => ev.title && (ev.title.includes('微感超標群聚事件') || ev.title.includes('區-微感事件') || ev.title.includes('微感事件')));
    if (oldSQLiteEvents.length > 0) {
      for (const ev of oldSQLiteEvents) {
        const threshMatch = ev.title.match(/門檻: PM₂.₅ (\d+(\.\d+)?)/);
        const thresh = threshMatch ? threshMatch[1] : '54';
        const newTitle = `[自動] 事件管理 (門檻: PM₂.₅ ${thresh})`;
        
        await db.run('UPDATE events SET title = ? WHERE id = ?', [newTitle, ev.id]);
        ev.title = newTitle; // 同步更新
      }
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

    const db = await getDb();
    const eventId = `event_${Date.now()}`;
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

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

