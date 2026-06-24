import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMockHistory } from '@/lib/mockData';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sensorId = searchParams.get('sensorId');
    const time = searchParams.get('time');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const limit = parseInt(searchParams.get('limit') || '1000', 10);

    const db = await getDb();
    if (!db) {
      // 降級為 Mock
      if (sensorId) {
        const mockHist = getMockHistory(sensorId, startTime || new Date().toISOString());
        return NextResponse.json(mockHist);
      }
      return NextResponse.json([]);
    }
    
    let query = 'SELECT * FROM observations WHERE 1=1';
    const params: any[] = [];

    if (sensorId) {
      query += ' AND sensor_id = ?';
      params.push(sensorId);
    }
    if (time) {
      query += ' AND time = ?';
      params.push(time);
    }
    if (startTime) {
      query += ' AND time >= ?';
      params.push(startTime);
    }
    if (endTime) {
      query += ' AND time <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY time ASC LIMIT ?';
    params.push(limit);

    const observations = await db.all(query, params);
    return NextResponse.json(observations);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

