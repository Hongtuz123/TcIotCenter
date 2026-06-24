import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { globalMockState, mockSensors } from '@/lib/mockData';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();
    const { title, description, status, bounds, sensorIds } = body;

    const db = await getDb();
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    if (!db) {
      // 降級為 Mock，在記憶體中更新事件
      const idx = globalMockState.events.findIndex(e => e.id === id);
      if (idx === -1) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }

      const existingEvent = globalMockState.events[idx];
      const associatedSensors = sensorIds 
        ? mockSensors.filter(s => sensorIds.includes(s.id))
        : existingEvent.sensors;

      globalMockState.events[idx] = {
        ...existingEvent,
        title: title || existingEvent.title,
        description: description !== undefined ? description : existingEvent.description,
        status: status || existingEvent.status,
        updated_at: nowStr,
        bounds: bounds || existingEvent.bounds,
        sensors: associatedSensors
      };

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
        SET title = ?, description = ?, status = ?, updated_at = ?, bounds = ?
        WHERE id = ?
      `, [
        title || event.title,
        description !== undefined ? description : event.description,
        status || event.status,
        nowStr,
        bounds ? JSON.stringify(bounds) : event.bounds,
        id
      ]);

      if (Array.isArray(sensorIds)) {
        await db.run('DELETE FROM event_sensors WHERE event_id = ?', [id]);
        for (const sensorId of sensorIds) {
          await db.run(`
            INSERT OR IGNORE INTO event_sensors (event_id, sensor_id)
            VALUES (?, ?)
          `, [id, sensorId]);
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
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
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

