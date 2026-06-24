import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { globalMockState } from '@/lib/mockData';

export async function GET() {
  try {
    const db = await getDb();
    if (!db) {
      // 降級為 Mock
      return NextResponse.json(globalMockState.settings);
    }
    const rows = await db.all('SELECT * FROM settings');
    const settingsObj = rows.reduce((acc: any, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    return NextResponse.json(settingsObj);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = await getDb();
    
    const allowedKeys = [
      'pm25_threshold',
      'temp_increase_threshold',
      'voc_threshold',
      'cluster_radius_km',
      'min_cluster_stations'
    ] as const;

    if (!db) {
      // 降級為 Mock 並更新記憶體設定
      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          (globalMockState.settings as any)[key] = parseFloat(body[key]);
        }
      }
      return NextResponse.json({ success: true });
    }

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
          key,
          String(body[key])
        ]);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

