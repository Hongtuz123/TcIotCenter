import path from 'path';
import fs from 'fs';

let dbInstance: any = null;
let isMockMode = false;

export async function getDb(): Promise<any> {
  if (isMockMode) {
    return null;
  }
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.resolve(process.cwd(), 'iot.db');
  
  // Vercel 部署或初次載入時若資料庫不存在，降級到 Mock 模式，完全避開載入 sqlite3 原生套件
  if (!fs.existsSync(dbPath)) {
    console.warn("SQLite database 'iot.db' not found. Activating Mock fallback mode.");
    isMockMode = true;
    return null;
  }

  try {
    // 關鍵優化：改為動態載入 (Dynamic Import)。
    // 這樣在 Vercel 雲端上執行時，若無 iot.db 檔案就不會觸發 sqlite3 的 require，
    // 從而避免了 Vercel 缺少 sqlite3 C 二進位綁定所產生的 FUNCTION_INVOCATION_FAILED 錯誤。
    const sqlite3 = await import('sqlite3');
    const { open } = await import('sqlite');

    dbInstance = await open({
      filename: dbPath,
      driver: sqlite3.default.Database
    });

    // 設定 sqlite 的 busy timeout，避免鎖庫問題
    await dbInstance.run('PRAGMA journal_mode = WAL');
    await dbInstance.run('PRAGMA busy_timeout = 5000');

    return dbInstance;
  } catch (err) {
    console.error("SQLite connection failed. Falling back to Mock mode:", err);
    isMockMode = true;
    return null;
  }
}
