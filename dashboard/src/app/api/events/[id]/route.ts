import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { globalMockState, mockSensors } from '@/lib/mockData';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, status, bounds, event_time, sensors } = body;

    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // ── Tier 1: Supabase（Vercel 線上環境）─────────────────────────────────────
    if (supabase) {
      const client = supabase;
      
      // 先查詢事件是否存在
      const { data: event, error: findErr } = await client
        .from('events')
        .select('*')
        .eq('id', id)
        .single();
      
      if (findErr || !event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }

      const { error: updateErr } = await client
        .from('events')
        .update({
          title: title || event.title,
          description: description !== undefined ? description : event.description,
          status: status || event.status,
          updated_at: nowStr,
          bounds: bounds ? JSON.stringify(bounds) : event.bounds,
          event_time: event_time !== undefined ? event_time : event.event_time,
          stations_count: Array.isArray(sensors) ? sensors.length : event.stations_count,
          avg_pm25: Array.isArray(sensors) && sensors.length > 0 
            ? sensors.reduce((acc: number, s: any) => acc + (s.pm2_5 || 0), 0) / sensors.length 
            : event.avg_pm25
        })
        .eq('id', id);

      if (updateErr) {
        throw updateErr;
      }
      return NextResponse.json({ success: true });
    }

    const db = await getDb();

    if (!db) {
      // 降級為 Mock，在記憶體中更新事件
      const idx = globalMockState.events.findIndex(e => e.id === id);
      if (idx === -1) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }

      const existingEvent = globalMockState.events[idx];
      globalMockState.events[idx] = {
        ...existingEvent,
        title: title || existingEvent.title,
        description: description !== undefined ? description : existingEvent.description,
        status: status || existingEvent.status,
        updated_at: nowStr,
        event_time: event_time !== undefined ? event_time : existingEvent.event_time,
        bounds: bounds || existingEvent.bounds,
        sensors: sensors || existingEvent.sensors
      } as any;

      return NextResponse.json({ success: true });
    }

    await db.run('BEGIN TRANSACTION');

    try {
      const event = await db.get('SELECT * FROM events WHERE id = ?', [id]);
      if (!event) {
        await db.run('ROLLBACK');
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }

      await db.run(`
        UPDATE events 
        SET title = ?, description = ?, status = ?, updated_at = ?, bounds = ?, event_time = ?
        WHERE id = ?
      `, [
        title || event.title,
        description !== undefined ? description : event.description,
        status || event.status,
        nowStr,
        bounds ? JSON.stringify(bounds) : event.bounds,
        event_time !== undefined ? event_time : event.event_time,
        id
      ]);

      if (Array.isArray(sensors)) {
        await db.run('DELETE FROM event_sensors WHERE event_id = ?', [id]);
        for (const s of sensors) {
          await db.run(`
            INSERT OR IGNORE INTO event_sensors (event_id, sensor_id, pm25, temperature, humidity, voc)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [id, s.id, s.pm2_5 ?? null, s.temperature ?? null, s.humidity ?? null, s.voc ?? null]);
        }
      }

      await db.run('COMMIT');
      return NextResponse.json({ success: true });
    } catch (txError) {
      await db.run('ROLLBACK');
      throw txError;
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // ── Tier 1: Supabase（Vercel 線上環境）─────────────────────────────────────
    if (supabase) {
      const client = supabase;
      const { error } = await client
        .from('events')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }
      return NextResponse.json({ success: true });
    }

    const db = await getDb();

    if (!db) {
      // 降級為 Mock，從記憶體中移除事件
      const idx = globalMockState.events.findIndex(e => e.id === id);
      if (idx === -1) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
      globalMockState.events.splice(idx, 1);
      return NextResponse.json({ success: true });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run('DELETE FROM event_sensors WHERE event_id = ?', [id]);
      await db.run('DELETE FROM events WHERE id = ?', [id]);
      await db.run('COMMIT');
      return NextResponse.json({ success: true });
    } catch (txError) {
      await db.run('ROLLBACK');
      throw txError;
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

