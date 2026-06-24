# 微感 GIS Dashboard - 專案備忘與自訂規則

## 📌 待辦備忘：如何將真實 1.72 GB SQLite 大數據遷移至雲端 (PostgreSQL) 的對接指引

**問題背景**：
為了避免 Vercel 部署上傳超出 100MB 限制，目前已在 `.gitignore` 與 `.vercelignore` 中排除了實體 `iot.db`。當專案在 Vercel 上執行時會自動降級為 Mock 數據。如果使用者未來想要在 Vercel 上跑 100% 真實數據，請依循以下指引：

### 1. 雲端資料庫設置
* 推薦在 **Supabase** 或 **Neon**（具備免費 PostgreSQL 額度）註冊並建立一個新資料庫。
* 取得資料庫連線字串（例如：`postgresql://user:password@host:port/dbname`）。

### 2. 資料表 Schema 遷移
* 本專案已預留 Prisma ORM 架構（定義檔位於 `dashboard/prisma/schema.prisma`）。
* 在本地 `dashboard` 目錄下執行以下指令，一鍵將四個核心大表（Sensors, Observations, Settings, Events）的 schema 推送至雲端資料庫：
  ```powershell
  npx prisma db push --schema=./prisma/schema.prisma
  ```

### 3. 本地真實數據同步到雲端
* 撰寫一個本地的 node 腳本或 python 腳本。
* 讀取本地的 `iot.db` (SQLite) 資料。
* 由於資料量達 1.72 GB（3000 多個感測器，整月 5 分鐘一筆的高頻觀測），必須採用**分批寫入（Batching Write）**的方式（例如每次 1,000 筆），避免記憶體溢出或雲端資料庫連線超時。

### 4. Vercel 連接設定
* 登入 Vercel 後台，進入專案的 `Settings` -> `Environment Variables`。
* 新增一組環境變數：
  * **Key**: `DATABASE_URL`
  * **Value**: 您的雲端 PostgreSQL 連線字串
* 重新部署專案。系統內的 `src/lib/db.ts` 偵測到 `DATABASE_URL` 後，便會自動停用 Mock 降級，無縫切換為直接從雲端 PostgreSQL 讀取 100% 真實的數據。
