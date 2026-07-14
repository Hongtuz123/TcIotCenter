# 微感監測中心 - 工程交接與技術規格書精進指南

> **署名**：PST-Tim
> **定位**：致接手工程團隊之系統分析 (SA) 與架構交接說明

這份指南旨在提供將系統移交給工程團隊（上線與維運）時，規格書需要補強的關鍵技術細節。工程師最關心的核心是：**「如何部署、資料如何流動、如何監控、掛掉時如何復原」**。

---

## 1. 運維部署拓撲 (Deployment Topology)
規格書應包含下述拓撲結構，以說明 Serverless 與背景排程的協作：

```mermaid
graph TD
    User([使用者瀏覽器]) -->|HTTPS| Vercel[Vercel Edge Network]
    Vercel -->|Next.js Client| User
    Vercel -->|Serverless APIs| Supabase[(Supabase PostgreSQL)]
    
    subgraph LocalHost [本地/邊緣備援環境]
        NextLocal[Next.js Local Server] -->|SQL Query| SQLite[(SQLite iot.db)]
    end
    
    subgraph DataIngestion [資料接入層]
        Cron[Cron Job / Background Worker] -->|Python / TS Script| EPA[環保署 API / 感測器網路]
        Cron -->|Write raw observations| Supabase
        Cron -->|Trigger anomaly detection| Vercel
    end
```

---

## 2. 核心數據流時序圖 (Data Flow Sequence)
規格書中需附帶下圖，說明事件偵測的生命週期與非同步解耦機制：

```mermaid
sequenceDiagram
    autonumber
    participant Worker as Background Poller
    participant API as Next.js API (/api/anomalies)
    participant DB as Supabase DB
    participant Client as Frontend Map
    
    Worker->>API: 1. 觸發異常分析請求 POST/GET (帶入當前時間)
    API->>DB: 2. 查詢該時間點前 N 筆觀測值 (Time range)
    DB-->>API: 返回觀測值數據
    Note over API: 3. 執行連續 N 筆超標判定 & Haversine 空間群聚計算
    API->>DB: 4. [非同步 Fire-and-Forget] 寫入/更新 Events 數據
    API-->>Worker: 5. 立即回傳計算結果 (HTTP 200 OK, <100ms)
    
    Note over Client: 6. 前端定時 Polling /api/events
    Client->>API: 讀取最新事件
    API->>DB: 讀取 events
    DB-->>Client: 返回 events
    Note over Client: 7. 前端 Point-in-Polygon 園區匹配並渲染紅色警示圈
```

---

## 3. 規格書精進的四個核心方向

### 📊 3.1 環境變數與秘密管理 (Secrets Management)
運維接手首先需要完整的環境變數清冊。規格書中應列出以下對照表：
*   `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`：Mapbox 3D 地圖權杖（前端權限，限制 Domain）。
*   `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`：Supabase 連線端點。
*   `SUPABASE_SERVICE_ROLE_KEY`：後端專用繞過 RLS 的 Master Key（嚴禁洩漏至前端）。
*   `DATABASE_URL`：本地 SQLite 路徑或外部 PostgreSQL Connection String。

### 🚨 3.2 非功能性需求與監控指標 (NFR & Observability)
工程師需要知道如何判定系統「活著且健康」：
*   **健康監測端點 (Health Check)**：指明可監控 <code>/api/completeness</code>，當完整率低於 70% 時，運維系統需向 PagerDuty/Slack 發送警報。
*   **API 頻率限制 (Rate Limiting)**：說明在高併發下，應在 Vercel Edge Component 或是 API 路由中使用 Redis 限流（Limit 100 req/min/IP），防止地圖點位遭惡意爬取。

### 🔄 3.3 錯誤容忍與災難復原 (Failover & Disaster Recovery)
當雲端服務中斷時的標準作業程序 (SOP)：
*   **Supabase 故障**：系統自動偵測並調用 SQLite 備援，前端拋出 Toast 提示「目前為本地離線模式」。
*   **數據補件機制**：若 Background Worker 因網路斷開漏掉數個時間點的 PM₂.₅，Poller 重新連線時必須支援「時間回補參數」（例如帶入 <code>?time=history_time</code>），重新補回漏掉的 Observations 與 Events。

### ⚙️ 3.4 後端背景任務維護 (Cron Specs)
*   說明 Python 排程腳本的執行頻率（建議每 5 分鐘執行一次，與觀測時間對齊）。
*   說明重試機制 (Retry Policy)：Poller 抓取外部 API 失敗時，應採取指數退避 (Exponential Backoff) 重試，最多 3 次。
