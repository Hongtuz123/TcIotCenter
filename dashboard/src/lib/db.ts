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
    // 終極優化：利用 eval("require('...')") 繞過 Webpack 與 Vercel Node File Trace (NFT) 的靜態分析依賴追蹤。
    // 這樣 Vercel 在打包 Serverless Function 時，會完全忽略並剔除 sqlite3 的原生 C 編譯綁定，
    // 從而 100% 根治冷啟動時原生模組加載失敗引發的 FUNCTION_INVOCATION_FAILED 崩潰！
    // 而在本地開發環境中，因為 node_modules 實體存在，Runtime 執行 eval("require") 仍能正常工作。
    const sqlite3 = eval("require('sqlite3')");
    const { open } = eval("require('sqlite')");

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
