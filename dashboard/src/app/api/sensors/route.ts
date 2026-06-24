import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { mockSensors } from '@/lib/mockData';

export async function GET() {
  try {
    const db = await getDb();
    if (!db) {
      // 降級為 Mock
      return NextResponse.json(mockSensors);
    }
    const sensors = await db.all('SELECT * FROM sensors');
    return NextResponse.json(sensors);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

