import { NextRequest, NextResponse } from 'next/server';
import { getWindData } from '@/lib/weather';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get('lat');
  const lonStr = searchParams.get('lon');

  if (!latStr || !lonStr) {
    return NextResponse.json({ error: '缺少經緯度參數 (lat, lon)' }, { status: 400 });
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: '經緯度格式錯誤' }, { status: 400 });
  }

  try {
    const windInfo = await getWindData(lat, lon);
    return NextResponse.json(windInfo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '無法取得氣象資料' }, { status: 500 });
  }
}
