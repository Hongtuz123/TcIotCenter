import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';

let dbInstance: Database | null = null;
let isMockMode = false;

export async function getDb(): Promise<Database | null> {
  if (isMockMode) {
    return null;
  }
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.resolve(process.cwd(), 'iot.db');
  
  // Vercel 部署或初次載入時若資料庫不存在，降級到 Mock 模式，確保前端不會報錯崩潰
  if (!fs.existsSync(dbPath)) {
    console.warn("SQLite database 'iot.db' not found. Activating Mock fallback mode.");
    isMockMode = true;
    return null;
  }

  try {
    dbInstance = await open({
      filename: dbPath,
      driver: sqlite3.Database
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

