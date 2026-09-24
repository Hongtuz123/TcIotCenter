import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { globalMockState } from '@/lib/mockData';

import { supabase } from '@/lib/supabase';

const allowedKeys = [
  'pm25_threshold',
  'consecutive_exceeds',
  'cluster_radius_km',
  'min_cluster_stations'
] as const;

export async function GET() {
  const DEFAULT_SETTINGS = {
    pm25_threshold: 50.4,
    consecutive_exceeds: 3,
    cluster_radius_km: 1.0,
    min_cluster_stations: 2
  };

  try {
    // ── Tier 1: 優先嘗試從 Supabase 讀取設定 ──────────────────────────
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('*');
        if (!error && data && data.length > 0) {
          const settingsObj = data.reduce((acc: any, row: any) => {
            acc[row.key] = parseFloat(row.value);
            return acc;
          }, {});
          return NextResponse.json({ ...DEFAULT_SETTINGS, ...settingsObj });
        }
      } catch (e) {
        // 忽略，降級至 SQLite
      }
    }

    // ── Tier 2: 降級為 SQLite ─────────────────────────────────────────
    const db = await getDb();
    if (!db) {
      // ── Tier 3: 降級為 Mock ──────────────────────────────────────────
      return NextResponse.json({ ...DEFAULT_SETTINGS, ...globalMockState.settings });
    }
    const rows = await db.all('SELECT * FROM settings');
    const settingsObj = rows.reduce((acc: any, row: any) => {
      acc[row.key] = parseFloat(row.value);
      return acc;
    }, {});
    return NextResponse.json({ ...DEFAULT_SETTINGS, ...settingsObj });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // ── Tier 1: 優先寫入 Supabase ──────────────────────────────────────
    if (supabase) {
      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          try {
            await supabase.from('settings').upsert({
              key,
              value: String(body[key])
            });
          } catch (e) {
            console.warn('Supabase settings upsert failed (possibly table settings does not exist yet):', e);
          }
        }
      }
    }

    // ── Tier 2: 同步寫入 SQLite (若本地存在) ───────────────────────────
    const db = await getDb();
    if (!db) {
      // ── Tier 3: 寫入 Mock 記憶體 ───────────────────────────────────────
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

