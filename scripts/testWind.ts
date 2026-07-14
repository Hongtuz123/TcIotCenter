// 使用原生 fetch

const STA_BASE = 'https://sta.colife.org.tw/STA_AirQuality_EPAIoT/v1.0';

async function test() {
  console.log('Searching for any datastreams with wind/speed/direction in name...');
  const url = `${STA_BASE}/Datastreams?$select=name&$top=1000`;
  const res = await fetch(url);
  const json = await res.json();
  const names = Array.from(new Set(json.value?.map((v: any) => v.name) || []));
  console.log('All unique names found (top 1000):', names);
}

test();
