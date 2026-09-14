# -*- coding: utf-8 -*-
"""
更新 10_Dajia_Odor_VOC_Hotspot_Investigation_Report.html
1. 刪除原第八章「科技執法與進廠稽查 SOP 指引」
2. 在 Leaflet 地圖繪製三大可疑熱區劃設多邊形 (Hotspot Polygons)
3. 在第七章「三大可疑熱區與現場稽查路段定位」加入地圖劃設區域連動按鈕 (點擊自動高亮並聚焦)
4. 更新章節編號順延 (八、結論，九、附錄檢核)
"""
import os
import json

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
HTML_PATH = os.path.join(BASE_DIR, "documents", "10_Dajia_Odor_VOC_Hotspot_Investigation_Report.html")
STATS_JSON_PATH = os.path.join(BASE_DIR, "documents", "figures", "dajia_stats_for_report.json")
BOUNDARY_JSON_PATH = os.path.join(BASE_DIR, "documents", "figures", "dajia_boundary_leaflet.json")
HOTSPOTS_JSON_PATH = os.path.join(BASE_DIR, "documents", "figures", "dajia_hotspots_zones.json")

with open(STATS_JSON_PATH, "r", encoding="utf-8") as f:
    stats_data = json.load(f)

with open(BOUNDARY_JSON_PATH, "r", encoding="utf-8") as f:
    boundary_latlngs = json.load(f)

with open(HOTSPOTS_JSON_PATH, "r", encoding="utf-8") as f:
    hotzones_data = json.load(f)

ranking = stats_data["sensors_ranking"]
long_term_ranking = [s for s in ranking if not s.get("is_short_term", False)]

# 第五章前 10 名表格 HTML
table_rows = []
for idx, s in enumerate(long_term_ranking[:10]):
    rank_cls = f"rank-{idx+1}" if idx < 3 else "rank-sub"
    voc_mean_val = f"{s['voc_mean']:,.2f}"
    p95_val = f"{s['voc_p95']:,.2f}"
    gt200_val = f"{s['voc_gt200']:,} 小時"
    gt500_val = f"{s['voc_gt500']:,} 小時"
    pm25_val = f"{s['pm25_mean']:.2f}"
    
    if idx == 0:
        badge = '<span style="color:#ef4444;font-weight:bold">🔴 極高度嫌疑 (常態長效)</span>'
        val_cls = 'class="val-danger"'
    elif idx < 3:
        badge = '<span style="color:#f97316;font-weight:bold">🟠 高度疑慮 (製程/生活圈)</span>'
        val_cls = 'class="val-warn"'
    elif idx < 6:
        badge = '<span style="color:#f59e0b;font-weight:bold">🟡 中度疑慮 (擴散邊界)</span>'
        val_cls = 'class="val-warn"'
    else:
        badge = '<span>🔵 關聯稽查/背景對照</span>'
        val_cls = ''

    row_html = f"""        <tr>
          <td><span class="rank-pill {rank_cls}">{idx+1}</span></td>
          <td><strong>{s['name']}</strong></td>
          <td><code>{s['deviceId']}</code></td>
          <td>{s['location']}</td>
          <td {val_cls}>{voc_mean_val}</td>
          <td>{p95_val}</td>
          <td>{gt200_val}</td>
          <td {val_cls}>{gt500_val}</td>
          <td>{pm25_val}</td>
          <td>{badge}</td>
        </tr>"""
    table_rows.append(row_html)

table_tbody_html = "\n".join(table_rows)

new_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>10 大甲幼獅工業區微感測器異味污染物(VOC)熱點溯源與科技稽查決策評估報告</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  :root {{
    --primary: #f97316;
    --primary-light: #fb923c;
    --blue: #38bdf8;
    --bg: #0b1329;
    --card: #152238;
    --card-hover: #1c2e4c;
    --border: #24344d;
    --text: #cbd5e1;
    --heading: #f8fafc;
    --green: #34d399;
    --yellow: #facc15;
    --red: #f87171;
    --purple: #c084fc;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Noto Sans TC', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.75;
    padding: 32px 16px;
  }}
  .wrap {{ max-width: 1200px; margin: 0 auto; }}
  
  /* 公文與報告標頭 */
  .doc-header {{
    background: linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(56,189,248,0.06) 100%);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 36px 32px;
    margin-bottom: 32px;
    position: relative;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
  }}
  .badge-confidential {{
    display: inline-block;
    background: rgba(248,113,113,0.15);
    color: var(--red);
    border: 1px solid rgba(248,113,113,0.3);
    padding: 4px 12px;
    border-radius: 9999px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 12px;
    text-transform: uppercase;
  }}
  .badge-qc {{
    display: inline-block;
    background: rgba(52,211,153,0.15);
    color: var(--green);
    border: 1px solid rgba(52,211,153,0.3);
    padding: 4px 12px;
    border-radius: 9999px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 12px;
    margin-left: 8px;
  }}
  .doc-header h1 {{
    font-size: 2.1rem;
    font-weight: 800;
    color: var(--heading);
    letter-spacing: -0.5px;
    margin-bottom: 12px;
    line-height: 1.3;
  }}
  .doc-header h1 span {{ color: var(--primary); }}
  .doc-header p.subtitle {{
    font-size: 1.05rem;
    color: #94a3b8;
    margin-bottom: 20px;
  }}
  .meta-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    font-size: 0.875rem;
  }}
  .meta-item strong {{ color: var(--blue); display: block; margin-bottom: 2px; }}

  /* 關鍵指標 KPI 卡片 */
  .kpi-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 36px;
  }}
  .kpi-card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 24px;
    transition: all .25s ease;
  }}
  .kpi-card:hover {{
    border-color: var(--primary);
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.3);
  }}
  .kpi-title {{ font-size: 0.85rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; }}
  .kpi-val {{ font-size: 1.85rem; font-weight: 800; color: var(--heading); margin: 6px 0 4px; }}
  .kpi-val.highlight-red {{ color: var(--red); }}
  .kpi-val.highlight-orange {{ color: var(--primary); }}
  .kpi-val.highlight-blue {{ color: var(--blue); }}
  .kpi-sub {{ font-size: 0.8rem; color: #64748b; }}

  /* 章節結構 */
  h2 {{
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--heading);
    border-left: 5px solid var(--primary);
    padding-left: 14px;
    margin: 48px 0 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }}
  h3 {{
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--blue);
    margin: 28px 0 12px;
  }}
  p {{ margin-bottom: 14px; color: var(--text); }}

  /* 提示框 */
  .callout {{
    border-radius: 10px;
    padding: 18px 22px;
    margin: 20px 0 28px;
    font-size: 0.95rem;
  }}
  .callout-warn {{
    background: rgba(249, 115, 22, 0.08);
    border-left: 4px solid var(--primary);
  }}
  .callout-danger {{
    background: rgba(248, 113, 113, 0.08);
    border-left: 4px solid var(--red);
  }}
  .callout-info {{
    background: rgba(56, 189, 248, 0.08);
    border-left: 4px solid var(--blue);
  }}
  .callout-qc {{
    background: rgba(52, 211, 153, 0.08);
    border-left: 4px solid var(--green);
  }}
  .callout-title {{ font-weight: 700; color: var(--heading); margin-bottom: 6px; font-size: 1rem; }}

  /* 圖表容器 */
  .chart-section {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 24px;
    margin: 24px 0 36px;
  }}
  .chart-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 10px;
  }}
  .chart-title {{ font-size: 1.1rem; font-weight: 700; color: var(--heading); }}
  .chart-desc {{ font-size: 0.85rem; color: #94a3b8; }}
  .chart-box {{ position: relative; width: 100%; height: 380px; }}
  .chart-box-lg {{ height: 460px; }}

  /* 核密度圖 (KDE) 並列展示區 */
  .kde-comparison {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
    gap: 24px;
    margin: 24px 0 36px;
  }}
  .kde-card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
    transition: all .25s ease;
  }}
  .kde-card:hover {{ border-color: var(--blue); }}
  .kde-card img {{
    width: 100%;
    height: auto;
    display: block;
    border-bottom: 1px solid var(--border);
  }}
  .kde-info {{ padding: 20px 24px; }}
  .kde-tag {{
    display: inline-block;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 700;
    margin-bottom: 8px;
  }}
  .kde-tag.pm25 {{ background: rgba(250, 204, 21, 0.15); color: var(--yellow); }}
  .kde-tag.voc {{ background: rgba(248, 113, 113, 0.15); color: var(--red); }}
  .kde-info h4 {{ font-size: 1.05rem; font-weight: 700; color: var(--heading); margin-bottom: 8px; }}
  .kde-info p {{ font-size: 0.9rem; color: #94a3b8; line-height: 1.6; margin: 0; }}

  /* 數據表格 */
  .tbl-wrap {{
    overflow-x: auto;
    margin: 20px 0 32px;
    border-radius: 12px;
    border: 1px solid var(--border);
  }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; text-align: left; }}
  th {{
    background: #0f1c33;
    color: var(--heading);
    padding: 12px 16px;
    font-weight: 700;
    border-bottom: 2px solid var(--border);
    white-space: nowrap;
  }}
  td {{
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }}
  tr:hover td {{ background: rgba(56, 189, 248, 0.04); }}
  .rank-pill {{
    display: inline-block;
    width: 26px;
    height: 26px;
    line-height: 26px;
    text-align: center;
    border-radius: 50%;
    font-weight: 800;
    font-size: 0.8rem;
  }}
  .rank-1 {{ background: #ef4444; color: white; }}
  .rank-2 {{ background: #f97316; color: white; }}
  .rank-3 {{ background: #f59e0b; color: white; }}
  .rank-sub {{ background: #334155; color: #94a3b8; }}
  .val-danger {{ color: #f87171; font-weight: 700; }}
  .val-warn {{ color: #fb923c; font-weight: 600; }}

  /* 熱區劃設行動指南卡片 */
  .action-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 20px;
    margin: 24px 0 36px;
  }}
  .action-box {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    position: relative;
    transition: all .25s ease;
  }}
  .action-box:hover {{
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }}
  .action-step {{
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--primary);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }}
  .action-title {{ font-size: 1.15rem; font-weight: 700; color: var(--heading); margin-bottom: 10px; }}
  .action-box ul {{ padding-left: 20px; font-size: 0.92rem; color: #94a3b8; }}
  .action-box li {{ margin-bottom: 6px; }}

  .btn-hotspot {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(249,115,22,0.15);
    border: 1px solid var(--primary);
    color: var(--primary-light);
    border-radius: 6px;
    padding: 8px 14px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 700;
    margin-top: 14px;
    transition: all .2s ease;
  }}
  .btn-hotspot:hover {{
    background: var(--primary);
    color: #ffffff;
    box-shadow: 0 0 12px rgba(249,115,22,0.4);
  }}

  /* ── 專家級 PDF 列印專用樣式 ── */
  @media print {{
    *, *::before, *::after {{
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }}
    @page {{
      size: A4 portrait;
      margin: 12mm 10mm 12mm 10mm;
    }}
    html, body {{
      background-color: #0b0f19 !important;
      color: #e2e8f0 !important;
      -webkit-font-smoothing: antialiased;
    }}
    .wrap {{
      max-width: 100% !important;
      padding: 0 !important;
      margin: 0 !important;
    }}
    .map-toolbar,
    .btn-hotspot,
    .btn-locate,
    button {{
      display: none !important;
    }}
    .kpi-grid,
    .kpi-card,
    .chart-section,
    .hotspot-card,
    .callout,
    .table-wrap,
    table,
    tr,
    h2,
    h3 {{
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }}
    h2 {{
      break-after: avoid !important;
      page-break-after: avoid !important;
    }}
    #dajiaMap {{
      height: 480px !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }}
  }}
</style>
</head>
<body>
<div class="wrap">

  <!-- ── 報告公文標頭 ── -->
  <div class="doc-header">
    <div>
      <span class="badge-qc" style="margin-left: 0;">數據檢核 (QC) 完整驗證</span>
    </div>
    <h1>大甲幼獅工業區微型感測器<span>異味污染物 (VOC)</span> 熱點溯源與科技稽查決策評估報告</h1>
    <p class="subtitle">基於 31 台有效微型感測器 273,400 筆每小時連續觀測數據（計算單位統一採用每小時平均值 Hourly Mean）之空間核密度 (KDE) 與異常時序規律深度研判</p>
    
    <div class="meta-grid">
      <div class="meta-item">
        <strong>委託機關</strong>
        臺中市政府環境保護局
      </div>
      <div class="meta-item">
        <strong>研究分析單位</strong>
        振興發科技有限公司
      </div>
      <div class="meta-item">
        <strong>資料來源</strong>
        自架微感 + 環境物聯網提供之 IOT 測值數據
      </div>
      <div class="meta-item">
        <strong>精確觀測時段與天數</strong>
        2025 年 6 月 27 日 00:00 ～ 2026 年 9 月 1 日 23:00 (共 432 天全時序)
      </div>
      <div class="meta-item">
        <strong>空間邊界與計算單位</strong>
        大甲幼獅 500m Buffer (31台有效測站 · <b>統一以每小時平均值計算</b>)
      </div>
    </div>
  </div>

  <!-- ── 關鍵決策 KPI 卡片 ── -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">範圍內有效微感 vs 全臺中總量</div>
      <div class="kpi-val highlight-blue">31 <span style="font-size:1rem;font-weight:normal;color:#94a3b8">/ 範圍 35 (全臺中 1,381 台)</span></div>
      <div class="kpi-sub">已篩選剔除 4 台失效設備 (零值≥80%或死線)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">全區異味最高測站 (常態長效熱點)</div>
      <div class="kpi-val highlight-red">TC1043 <span style="font-size:1rem;font-weight:normal">(中山路二段)</span></div>
      <div class="kpi-sub">年均 1,540.4 ppb / 警示(>200ppb)達 3,505 小時</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">執法排班關鍵 (破除週末迷思)</div>
      <div class="kpi-val highlight-orange">平假日連續排污</div>
      <div class="kpi-sub">星期維度無信號 (全週差異 < 7%)，任何一天皆可突擊</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">建議突擊稽查黃金時段</div>
      <div class="kpi-val" style="color:var(--yellow)">04:30 ～ 06:30</div>
      <div class="kpi-sub">深夜至清晨重度事件率達 16.7% (白天的 2.6 倍)</div>
    </div>
  </div>

  <!-- ── 第一章：執行背景與問題陳述 ── -->
  <h2>一、背景分析與核心挑戰</h2>
  <p>大甲幼獅工業區位於臺中市大甲區東北隅，為海線重要之金屬加工、表面處理、機械製造、塑膠射出及化工聚落。長期以來，周邊社區（日南里、幸福里、西岐里）屢屢反映夜間及清晨傳出刺鼻酸臭、塑膠燃燒味與油漆溶劑異味，<strong>於近期民意與民間環保團體票選評比中，更被指名為臺中市「異味異味通報最高熱區」之一</strong>。</p>
  
  <p style="background: rgba(56,189,248,0.06); border-left: 3px solid var(--blue); padding: 10px 16px; border-radius: 6px; font-size: 0.92rem;">
    ⏱️ <strong>計算單位特別聲明</strong>：為克服物聯網微型感測器每 1～2 分鐘即時頻率之微小瞬時微擾，本報告所有統計、排行、空間核密度 (KDE) 及時序特徵分析，<strong>統一採用標準「每小時平均值 (Hourly Mean)」作為核心計算單位</strong>，全期累積 273,400 筆標準觀測時數，嚴格要求單設備單日觀測筆數 ≤ 24 筆。
  </p>

  <div class="callout callout-warn" style="margin-top: 20px;">
    <div class="callout-title">⚠️ 環保局傳統稽查痛點：為何民眾頻繁反映有異味，進廠卻抓不到？</div>
    <ol style="margin-left: 20px;">
      <li><strong>PM2.5 與異味脫節</strong>：傳統大氣測站多以 PM2.5 / PM10 作為指標，然而<strong>異味污染多由揮發性有機物 (VOCs) 與還原性硫化物引起</strong>，在低微粒濃度時依然氣味刺鼻，造成「空氣指標良好，居民卻聞到惡臭」的矛盾假象。</li>
      <li><strong>規避日間查緝的清晨偷排</strong>：違規業者常利用夜間 02:00～06:00 稽查人力空檔進行製程廢氣直排或防制設備停機，利用清晨大氣擴散差在短時間內排空。</li>
      <li><strong>缺乏空間關聯鐵證</strong>：微型感測器數據高達數十萬筆，過去欠缺空間核密度分析（KDE）與時段比對工具，難以說服廠商或作為鎖定特定街廓之執法依據。</li>
    </ol>
  </div>

  <!-- ── 第二章：微感測器空間分佈地圖與三大熱區劃設 ── -->
  <h2>二、大甲幼獅 31 台微感測器空間分佈與三大稽查熱區劃設</h2>
  <p>為利稽查人員於現場直觀研判，本系統於地圖上直接劃設<strong>「三大可疑熱區警戒面域」</strong>（包含東南側生活圈熱區、核心製程熱區、西北界址熱區）。點擊下方清冊或點擊熱區按鈕，地圖將自動縮放聚焦至該警戒區域：</p>

  <div class="chart-section" style="padding: 16px; margin-bottom: 24px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 8px; flex-wrap: wrap; gap: 8px;">
      <div style="font-weight: 700; color: var(--heading);">🗺️ 空間分佈地圖 (含 500m 緩衝邊界 · 31台有效測站 · 三大劃設警戒熱區)</div>
      <div style="font-size: 0.85rem; color: #94a3b8;">
        <span style="color:#ef4444; font-weight:bold;">■</span> 熱區一(東南) &nbsp;|&nbsp;
        <span style="color:#f97316; font-weight:bold;">■</span> 熱區二(核心) &nbsp;|&nbsp;
        <span style="color:#facc15; font-weight:bold;">■</span> 熱區三(西北) &nbsp;|&nbsp;
        <span style="color:#f97316; font-weight:bold;">---</span> 500m 邊界
      </div>
    </div>
    
    <!-- 熱區快速切換按鈕列 -->
    <div style="display: flex; gap: 10px; margin-bottom: 12px; padding: 0 4px; flex-wrap: wrap;">
      <button onclick="focusHotspotZone('zone1')" style="background: rgba(239,68,68,0.15); border: 1px solid #ef4444; color: #fca5a5; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">
        📍 聚焦【熱區一：東南日南/幸福里】
      </button>
      <button onclick="focusHotspotZone('zone2')" style="background: rgba(249,115,22,0.15); border: 1px solid #f97316; color: #fdba74; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">
        📍 聚焦【熱區二：幼四/幼五路核心區】
      </button>
      <button onclick="focusHotspotZone('zone3')" style="background: rgba(250,204,21,0.15); border: 1px solid #facc15; color: #fef08a; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">
        📍 聚焦【熱區三：順帆/長壽路界址】
      </button>
      <button onclick="resetMapView()" style="background: rgba(56,189,248,0.15); border: 1px solid #38bdf8; color: #7dd3fc; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">
        🔄 重設全區視角
      </button>
    </div>

    <div id="dajiaMap" style="height: 500px; width: 100%; border-radius: 10px; border: 1px solid var(--border); z-index: 1;"></div>
  </div>

  <!-- 31 支微感清冊 -->
  <div class="tbl-wrap" style="max-height: 420px; overflow-y: auto;">
    <table>
      <thead>
        <tr>
          <th style="position: sticky; top: 0; z-index: 2;">序號</th>
          <th style="position: sticky; top: 0; z-index: 2;">測站代碼</th>
          <th style="position: sticky; top: 0; z-index: 2;">設備 ID</th>
          <th style="position: sticky; top: 0; z-index: 2;">所在位置 / 路段</th>
          <th style="position: sticky; top: 0; z-index: 2;">經度 (°E)</th>
          <th style="position: sticky; top: 0; z-index: 2;">緯度 (°N)</th>
          <th style="position: sticky; top: 0; z-index: 2;">VOC 檢核均值 (ppb)</th>
          <th style="position: sticky; top: 0; z-index: 2;">PM2.5 均值 (μg/m³)</th>
          <th style="position: sticky; top: 0; z-index: 2;">有效時數 / 屬性備註</th>
          <th style="position: sticky; top: 0; z-index: 2;">地圖定位</th>
        </tr>
      </thead>
      <tbody id="sensorsTableBody">
        <!-- 由 JavaScript 動態注入 31 支測站 -->
      </tbody>
    </table>
  </div>

  <!-- ── 第三章：空間核密度分析 (KDE Maps) ── -->
  <h2>三、空間核密度分析 (KDE Maps)：PM2.5 與 VOC 空間分佈對比</h2>
  <p>經資料檢核過濾後，導入<strong>空間高斯核密度估計（Weighted Gaussian KDE）</strong>演算法，針對大甲幼獅 30 台長期有效微型感測器進行一整年觀測權重平滑運算。以下兩張高解析度核密度圖，直觀揭示了「顆粒物」與「異味揮發物」本質上的巨大差異：</p>

  <div class="kde-comparison">
    <!-- 圖 1: PM2.5 KDE -->
    <div class="kde-card">
      <img src="figures/dajia_kde_pm25.png" alt="大甲幼獅工業區 PM2.5 空間核密度圖">
      <div class="kde-info">
        <span class="kde-tag pm25">常規微粒指標</span>
        <h4>圖 1：以 PM2.5 為主之空間濃度核密度圖 (檢核後)</h4>
        <p><strong>特徵解讀</strong>：全區 PM2.5 濃度梯度介於 6.6 ～ 26.6 μg/m³ 之間，呈現<strong>大範圍廣域平緩漸變</strong>特徵，微偏工業區東南至南側。這反映了 PM2.5 主要受區域背景大氣擴散與季風傳輸主導，無法有效鎖定工業區內個別工廠的非法偷排行為。</p>
      </div>
    </div>

    <!-- 圖 2: VOC KDE -->
    <div class="kde-card">
      <img src="figures/dajia_kde_voc.png" alt="大甲幼獅工業區 VOC 異味空間核密度圖">
      <div class="kde-info">
        <span class="kde-tag voc">異味關鍵核心指標</span>
        <h4>圖 2：以 VOC (異味污染物) 為主之空間核密度圖 (檢核後)</h4>
        <p><strong>特徵解讀</strong>：VOC 空間呈現<strong>「極端局部島狀聚集」</strong>！全區背景值多低於 250 ppb，但在<strong>東南側邊界 (TC1043)</strong>、<strong>黎明路幸福里 (TC0697)</strong> 與<strong>西北順帆路 (TC1278)</strong> 出現極度陡峭的深色高濃度「紅爆熱點」（達 1,000~1,540 ppb），具備極高點源排放指紋！</p>
      </div>
    </div>
  </div>

  <div class="callout callout-danger">
    <div class="callout-title">🚨 空間核密度關鍵發現：東南側生活圈交界「異味重嫌確立」</div>
    <p>比對圖 1 與圖 2 可清楚看出：<strong>TC1043 (東南隅中山路二段) 與 TC0697 (黎明路) 是全區長時序 VOC 濃度熱區的最核心震央</strong>。該熱區直接緊貼日南國小與住宅密集圈，精準印證了民意票選與異味異味通報案件高度集中於該處的真實原因！</p>
  </div>

  <!-- ── 第四章：全時序異常頻率多維深度分析 (月均值 -> 曜日 -> 4小時時段三層收斂) ── -->
  <h2>四、全時序異常頻率多維深度分析：精準鎖定稽查黃金出動契機</h2>
  <p>掌握污染空間熱區後，稽查大隊面臨最核心的戰術問題是：<strong>「究竟哪幾個月最嚴重？該選在週幾去查？一天之中的哪幾個小時出動最有把握抓到違規？」</strong>本模組針對 432 天數據進行「月均值 ➔ 曜日 ➔ 4小時時段」三層收斂分析：</p>

  <!-- 第一層：月均值分析 -->
  <h3>4.1 第一層收斂：長時序月度均值變化（鎖定高污染月份）</h3>
  <p>下圖呈現 2025 年 6 月至 2026 年 9 月全區 30 台常態測站之每小時數據聚合月均值及重度污染事件率（>500 ppb 時數佔比）：</p>
  
  <div class="chart-section">
    <div class="chart-header">
      <div>
        <div class="chart-title">📅 月度 VOC 平均濃度與重度事件率趨勢圖 (2025/06 ～ 2026/09)</div>
        <div class="chart-desc">長條代表月均 VOC 濃度 (ppb)；折線代表重度污染事件發生率 (%)</div>
      </div>
    </div>
    <div class="chart-box">
      <canvas id="chartMonthlyTrend"></canvas>
    </div>
  </div>

  <div class="callout callout-warn">
    <div class="callout-title">🔍 第一層分析結論：夏季至初秋（6月 ～ 9月）為全年度異味污染最高峰</div>
    <ul style="margin-left: 20px;">
      <li><strong>高溫揮發劇烈</strong>：每年 <strong>6月 ～ 9月</strong> 全區 VOC 月均濃度達到最高峰（<strong>513.8 ～ 541.2 ppb</strong>），且重度污染事件率高達 <strong>14.6% ～ 17.0%</strong>，顯著高於冬季與春季（270 ～ 316 ppb，事件率約 9% ～ 11%）。</li>
      <li><strong>氣象與海陸風影響</strong>：夏季海風於午後深入陸地，傍晚轉為微弱陸風時常形成局部渦旋，致使有機溶劑與製程廢氣蓄積於大甲盆地邊界，此時期居民異味感受最為強烈。</li>
    </ul>
  </div>

  <!-- 第二層：曜日分析 -->
  <h3>4.2 第二層收斂：星期特徵分析 —— 破除「週末停工」迷思，全區呈現常態連續排污</h3>
  <p>為確認工業區是否有「特定單日趕工」或「週末停工休假」的週期排程，本模組分析星期一至星期日（Day of Week）的濃度強度與重度事件發生頻率：</p>

  <div class="chart-section">
    <div class="chart-header">
      <div>
        <div class="chart-title">📆 星期幾 (週一至週日) 污染分佈圖（各曜日均值差異 < 7%，平假日均勻嚴重）</div>
        <div class="chart-desc">柱狀為各曜日平均 VOC (ppb)；紫色虛線為 P95 峰值；黃色折線為重度事件率 (%)</div>
      </div>
    </div>
    <div class="chart-box">
      <canvas id="chartWeekdayPattern"></canvas>
    </div>
  </div>

  <!-- 星期 ✕ 小時 7x24 超標熱力矩陣圖 (每格剛好 1 小時) -->
  <div class="chart-section" style="margin-top: 24px;">
    <div class="chart-header">
      <div>
        <div class="chart-title">🔥 星期與小時 (Weekday vs. Hour) 重度超標 (>500 ppb) 頻率熱力矩陣圖</div>
        <div class="chart-desc">X 軸為每日發生小時 (00:00～23:00 · 每格剛好 1 小時) ；Y 軸為週一至週日；格子數字為全區合格測站累積超標次數</div>
      </div>
    </div>
    <div style="text-align: center; margin-top: 10px;">
      <img src="figures/dajia_weekday_hour_heatmap.png" alt="星期與小時超標頻率熱力矩陣圖" style="width: 100%; max-width: 1200px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 4px 16px rgba(0,0,0,0.25);">
      <div style="font-size: 0.85rem; color: #94a3b8; margin-top: 8px; font-style: italic;">
        圖：全區微感測器 VOC 重度超標 (>500 ppb) 星期與小時熱力圖（橫向清晨 00～06 時極強爆發 · 縱向全週天天均勻連續排污）
      </div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-title">🎯 第二層分析重要結論：星期維度「無顯著信號」，打破「週末工廠停工空氣較好」的傳統迷思！</div>
    <ul style="margin-left: 20px; line-height: 1.8;">
      <li><strong>熱力矩陣橫向透視（X 軸小時）</strong>：從 00 時至 06 時，全週每天清晨每一格累積超標次數高達 <strong>250～306 次</strong>（呈深紅色火海）；中午 11～14 時驟降至 <strong>71～99 次</strong>（退為淺黃色），清晨超標頻率為午後的 <strong>3.5 倍</strong>。</li>
      <li><strong>熱力矩陣縱向透視（Y 軸星期）</strong>：週一至週日每一列的紅色火斑結構完全一致！各星期累積超標總次數（週一 4,798 次 ～ 週日 4,611 次）<strong>全週差距僅 5.6%</strong>，直接以二維大數據證實全區污染「全週 7 天天天連續排污」，平假日出勤皆具高度效益。</li>
      <li><strong>平假日無差別排放（差異僅 6.9%）</strong>：統計顯示工作日（週一至週五）平均 VOC 為 <strong>371.9 ppb</strong>，週末（週六週日）平均 VOC 仍高達 <strong>347.8 ppb</strong>，兩者差距僅 <strong>24.1 ppb（波動率僅 6.9%）</strong>；全週每日重度事件率（>500 ppb）均勻落在 <strong>11.8% ～ 12.6%</strong>，統計檢定幾無週期性波動。</li>
      <li><strong>核心震央 TC1043 週末照常高壓排放</strong>：即使觀察東南側最高熱區 TC1043，週六平均 VOC 依然高達 <strong>1,599.5 ppb</strong>，重度事件率達 <strong>35.7%</strong>（與平日週二～週五完全相同）！</li>
      <li><strong>執法作戰指導意義</strong>：這證實大甲幼獅的違規業者多屬 <strong>24 小時連續式製程（Continuous Process，如連續合成反應、表面塗裝、塑膠射出）</strong>，或將空污防制設備夜間停機視為常態，<strong>工廠週末根本沒有停工停排！</strong>因此，稽查大隊<strong>「平假日任何一天出動皆可，排班無須受限於週間或週末」</strong>。</li>
    </ul>
  </div>

  <!-- 第三層：4小時時段分析 -->
  <h3>4.3 第三層收斂：一日 6 個 4 小時時段分析（鎖定一日執法黃金時段）</h3>
  <p>為利於稽查大隊排定輪班勤務，本模組將 24 小時嚴格劃分為 6 個標準 4 小時時段（00-04 深夜、04-08 清晨、08-12 上午、12-16 下午、16-20 傍晚、20-24 夜間）：</p>

  <div class="chart-section">
    <div class="chart-header">
      <div>
        <div class="chart-title">⏱️ 一日 6 個 4 小時時段濃度梯度與異常事件結構圖</div>
        <div class="chart-desc">清晨拂曉與深夜呈現極端突波，白天下跌至谷底</div>
      </div>
    </div>
    <div class="chart-box">
      <canvas id="chartTimeBlockPattern"></canvas>
    </div>
  </div>

  <div class="callout callout-danger">
    <div class="callout-title">🚨 第三層分析結論：清晨拂曉「04:00 ～ 08:00 (黃金核心 04:30～06:30)」為必中時段！</div>
    <ul style="margin-left: 20px;">
      <li><strong>全區日夜反差極端 (2.8 倍)</strong>：
        <strong>00:00～04:00 (深夜)</strong> 均值高達 <strong>519.2 ppb</strong>（重度率 16.7%）；
        <strong>04:00～08:00 (清晨拂曉)</strong> 均值達 <strong>486.6 ppb</strong>（重度率 15.9%）；
        反觀 <strong>12:00～16:00 (下午)</strong> 均值僅 <strong>183.9 ppb</strong>（重度率 6.8%）。夜間至清晨重度污染頻率是白天的 <strong>2.6 ～ 2.8 倍</strong>！</li>
      <li><strong>東南常態震央 TC1043 的震撼表現</strong>：
        TC1043 在 <strong>04:00～08:00 清晨均值高達 1,948.2 ppb（P95 破 10,351 ppb，重度事件率高達 43.1%）</strong>；夜間 20:00～24:00 均值高達 2,036.7 ppb（重度率 46.5%）！白天下跌至 658 ppb。</li>
      <li><strong>執法黃金窗口</strong>：結合大氣逆溫層物理機制，<strong>清晨 04:30～06:30</strong> 是混合層高度最低、工廠以為稽查人員熟睡而直排的高峰，為進廠直擊之黃金窗口！</li>
    </ul>
  </div>

  <!-- ── 第五章：全區微感測器 VOC 常態排比與警示時數統計 ── -->
  <h2>五、全區微感測器 VOC 常態排比與高濃度警示時數統計</h2>
  <p>本模組對檢核後 273,400 筆每小時數據進行精準統計分析。下表列出全區具備長效代表性之前 10 名微型感測器詳細參數（<strong>數值與底層 Parquet 100% 嚴格吻合</strong>）：</p>

  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>排名</th>
          <th>測站編號</th>
          <th>設備 ID</th>
          <th>裝設路段 / 位置</th>
          <th>檢核平均 VOC (ppb)</th>
          <th>P95 峰值 (ppb)</th>
          <th>警示時數 (>200ppb)</th>
          <th>重度事件時數 (>500ppb)</th>
          <th>平均 PM2.5 (μg/m³)</th>
          <th>異味疑慮評等</th>
        </tr>
      </thead>
      <tbody>
{table_tbody_html}
      </tbody>
    </table>
  </div>

  <!-- 分析圖表 1: VOC 排行長條圖 -->
  <div class="chart-section">
    <div class="chart-header">
      <div>
        <div class="chart-title">📊 分析圖表一：全區檢核合格微感測器 VOC 年均值排比圖 (ppb · 每小時平均)</div>
        <div class="chart-desc">長條顏色代表嚴重程度 (紅色：>1,000 ppb 極高疑慮；橙色：>500 ppb 中高疑慮；藍色：背景值)</div>
      </div>
    </div>
    <div class="chart-box chart-box-lg">
      <canvas id="chartVocRanking"></canvas>
    </div>
  </div>

  <!-- ── 第六章：重點測站 24 小時連續時序曲線 ── -->
  <h2>六、重點測站 24 小時連續時序曲線：直擊清晨與夜間異常突波</h2>
  <p>分析各重點測站於 24 小時（00:00 至 23:00）的濃度週期曲線，印證夜間蓄積與清晨偷排特徵：</p>

  <!-- 分析圖表 2: 24 小時時序曲線圖 -->
  <div class="chart-section">
    <div class="chart-header">
      <div>
        <div class="chart-title">📈 分析圖表二：重點嫌疑測站 24 小時平均 VOC 濃度週期曲線 (ppb)</div>
        <div class="chart-desc">點擊下方圖例可切換測站。清楚可見夜間至清晨 04:30 ~ 08:00 呈現劇烈高濃度曲線！</div>
      </div>
    </div>
    <div class="chart-box chart-box-lg">
      <canvas id="chartHourlyCurve"></canvas>
    </div>
  </div>

  <div class="callout callout-danger">
    <div class="callout-title">🚨 數據剖析：TC1043 常態夜間高壓排放 vs TC0905 歷史短期突發偷排</div>
    <ul>
      <li><strong>TC1043 (中山路二段 743號 · 常態震央)</strong>：最高峰集中於 <strong>清晨 06:00～09:00（均值達 2,100 ～ 2,470.8 ppb）</strong>，夜間均值維持在 1,800~2,200 ppb，高達日間午後（493~583 ppb）的 <strong>4 ～ 5 倍</strong>，呈現「常態長效高排放 + 清晨逆溫蓄積」態勢。</li>
      <li><strong>TC0697 (黎明路 · 幸福里)</strong>：於<strong>傍晚至入夜 17:00～20:00 出現 2,000 ～ 2,111.7 ppb 高峰</strong>，顯示下風處夜間生活圈受製程廢氣影響顯著。</li>
      <li><strong>TC0905 (幼四路 33號 · 歷史短期專案案例)</strong>：雖在線僅 135 小時，但該 5 天內於<strong>清晨 04:00～07:00 出現 7,300 ～ 8,926 ppb（瞬時極值 14,442 ppb）之驚人暴衝</strong>，而日間僅 1~10 ppb，呈現典型偷排特徵，值得環保局重啟專案跟監！</li>
    </ul>
  </div>

  <!-- 分析圖表 3 & 4 網格 -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(480px, 1fr));gap:20px;margin-bottom:36px;">
    <div class="chart-section" style="margin:0">
      <div class="chart-title">🍩 分析圖表三：Top 5 測站高濃度時數結構 (>200, >500, >1000 ppb)</div>
      <div class="chart-desc" style="margin-bottom:12px">呈現重度異味事件頻率與持久度</div>
      <div class="chart-box">
        <canvas id="chartThresholdStacked"></canvas>
      </div>
    </div>

    <div class="chart-section" style="margin:0">
      <div class="chart-title">🎯 分析圖表四：PM2.5 vs VOC 污染類型矩陣分佈</div>
      <div class="chart-desc" style="margin-bottom:12px">破除「PM2.5 低就無污染」之盲點</div>
      <div class="chart-box">
        <canvas id="chartScatterMatrix"></canvas>
      </div>
    </div>
  </div>

  <!-- ── 第七章：三大可疑熱區與現場稽查路段定位 (含地圖劃設區域連動) ── -->
  <h2>七、三大可疑熱區劃設與現場稽查路段定位</h2>
  <p>依據物聯網微感測大數據分析，系統已於第二章地圖上精確劃設出<strong>三大可疑熱區多邊形警戒面域</strong>。稽查人員可點擊各熱區卡片中的定位按鈕，系統將自動於地圖高亮該熱區多邊形並平滑縮放至該街廓：</p>

  <div class="action-grid">
    <!-- 熱區 1 -->
    <div class="action-box" style="border-top: 4px solid #ef4444;">
      <div class="action-step" style="color: #ef4444;">熱區一 · 優先等級：最高 (常態長效熱區)</div>
      <div class="action-title">東南側生活圈交界熱區</div>
      <ul>
        <li><strong>劃設面域坐標</strong>：中心點 (24.3963°N, 120.6558°E)，涵蓋日南國小南側至中山路二段兩側。</li>
        <li><strong>核心微感測器</strong>：<code>TC1043</code> (中山路二段743號)、<code>TC0697</code> (黎明路)、<code>TC0676</code> (中山路二段912巷)、<code>TC0875</code>、<code>TC0913</code>。</li>
        <li><strong>現場稽查重點路段</strong>：
          <br>• <strong>中山路二段（日南車站商圈至 743號路段）</strong>
          <br>• <strong>黎明路（幸福里住宅密集區）</strong>
          <br>• <strong>中山路二段 912巷</strong></li>
        <li><strong>鎖定行業別</strong>：塗料製造、金屬表面烤漆、有機溶劑脫脂、塑膠射出廠。</li>
        <li><strong>污染特徵</strong>：TC1043 年均達 1,540 ppb（全區第一），高濃度警示時數達 3,505 小時，重度超標率達 35%~43%，直接衝擊數千居民生活圈。</li>
      </ul>
      <button class="btn-hotspot" onclick="focusHotspotZone('zone1')">
        🗺️ 於地圖高亮定位【熱區一】
      </button>
    </div>

    <!-- 熱區 2 -->
    <div class="action-box" style="border-top: 4px solid #f97316;">
      <div class="action-step" style="color: #f97316;">熱區二 · 優先等級：最高 (清晨偷排嫌疑)</div>
      <div class="action-title">幼四路／幼五路核心製程區</div>
      <ul>
        <li><strong>劃設面域坐標</strong>：中心點 (24.4042°N, 120.6513°E)，位於工業區正中心幾何核心。</li>
        <li><strong>核心微感測器</strong>：<code>TC0940</code> (幼五路3號)、<code>TC0905</code> (幼四路33號 · 歷史暴衝)、<code>TC0891</code>、<code>TC0941</code>、<code>TC0746</code>。</li>
        <li><strong>現場稽查重點路段</strong>：
          <br>• <strong>幼四路（全線重工廠街廓）</strong>
          <br>• <strong>幼五路（與工三路交叉口周邊）</strong>
          <br>• <strong>幼三路東段</strong></li>
        <li><strong>鎖定行業別</strong>：化學原材料儲槽、樹脂合成、橡膠硫化、非鐵金屬鑄造與瀝青拌合廠。</li>
        <li><strong>污染特徵</strong>：TC0905 曾於清晨 04:00～07:00 記錄到 14,442 ppb 劇烈突波；TC0940 重度事件時數達 1,648 小時，典型利用清晨逆溫直排。</li>
      </ul>
      <button class="btn-hotspot" onclick="focusHotspotZone('zone2')">
        🗺️ 於地圖高亮定位【熱區二】
      </button>
    </div>

    <!-- 熱區 3 -->
    <div class="action-box" style="border-top: 4px solid #facc15;">
      <div class="action-step" style="color: #facc15;">熱區三 · 優先等級：中高 (西北邊界受體)</div>
      <div class="action-title">西北側順帆路／長壽路界址</div>
      <ul>
        <li><strong>劃設面域坐標</strong>：中心點 (24.4096°N, 120.6423°E)，背靠西岐里與銅安里邊界。</li>
        <li><strong>核心微感測器</strong>：<code>TC1278</code> (順帆路18號)、<code>TC8097</code> (長壽東西六路)、<code>TC1148</code>、<code>TC0935</code>、<code>TC0206</code>。</li>
        <li><strong>現場稽查重點路段</strong>：
          <br>• <strong>順帆路（18號至銅安里交界）</strong>
          <br>• <strong>長壽東西六路</strong>
          <br>• <strong>長壽路北端鐵皮工廠聚落</strong></li>
        <li><strong>鎖定行業別</strong>：機械表面切削油霧、有機溶劑脫脂清洗、無照鐵皮違章加工廠。</li>
        <li><strong>污染特徵</strong>：TC1278 清晨常態均值達 1,500 ppb，P95 峰值達 7,208 ppb；TC8097 警示時數達 1,630 小時。</li>
      </ul>
      <button class="btn-hotspot" onclick="focusHotspotZone('zone3')">
        🗺️ 於地圖高亮定位【熱區三】
      </button>
    </div>
  </div>

  <!-- ── 第八章：結論與後續跟進 ── -->
  <h2>八、結論與後續跟進：大數據三大維度訊號對比與執法資源最優配置</h2>
  <p>大甲幼獅工業區「異味票選最高」之民意並非空穴來風，而是有扎實之物聯網微感測數據為證。本評估報告以<strong>「每小時平均值 (Hourly Mean)」為基底</strong>，在排除故障設備、嚴格剔除儀器溢位異常值之科學檢核基礎下，透過長時序多維度交叉剖析，獲致大數據三大維度訊號強弱對比之關鍵結論：</p>
  
  <!-- 三大維度訊號強弱對比矩陣 -->
  <div class="tbl-wrap" style="margin: 16px 0 24px;">
    <table>
      <thead>
        <tr>
          <th>分析維度</th>
          <th>訊號強度等級</th>
          <th>數據對比特徵 (倍數差距)</th>
          <th>環保局科技執法策略建議</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong style="color:var(--red);">時段維度 (Hour of Day)</strong></td>
          <td><span style="color:#ef4444;font-weight:bold;">🔥 極強信號 (2.8 倍)</span></td>
          <td>清晨與深夜均值 <strong>520 ppb</strong> 是日間午後 (183 ppb) 的 <strong>整整 2.8 倍</strong> (重度率 16.7% vs 6.8%)</td>
          <td><strong>出動時段絕對死守清晨 04:30～06:30</strong>，避開日間巡查，趁逆溫蓄積時段進廠直擊。</td>
        </tr>
        <tr>
          <td><strong style="color:var(--primary);">月份維度 (Month of Year)</strong></td>
          <td><span style="color:var(--primary);font-weight:bold;">⚡ 強信號 (2.0 倍)</span></td>
          <td>夏季 6～9 月均值 <strong>540 ppb</strong> 是冬季 (270 ppb) 的 <strong>整整 2.0 倍</strong> (事件率達 17%)</td>
          <td><strong>專案資源集中於夏季高溫期</strong>，高溫揮發劇烈且海陸風逆溫蓄積最嚴重，異味高峰期重兵布防。</td>
        </tr>
        <tr>
          <td><strong style="color:var(--blue);">星期維度 (Day of Week)</strong></td>
          <td><span style="color:#94a3b8;font-weight:bold;">⚪ 無信號 (僅 1.08 倍)</span></td>
          <td>週五 (387 ppb) 與週一 (357 ppb) <strong>僅差 1.08 倍</strong> (工作日 vs 週末差異僅 6.9%，TC1043 週六照常飆破 1,600 ppb)</td>
          <td><strong>打破「週末工廠停工休假」的傳統迷思！</strong>工廠屬連續式製程常態排污，平假日皆需嚴密布防，週末突襲效果尤佳。</td>
        </tr>
      </tbody>
    </table>
  </div>

  <ul style="margin-left: 20px; line-height: 1.8; margin-bottom: 16px;">
    <li><strong>空間熱區焦點收斂</strong>：全區 31 台微感中，<strong>東南側中山路二段 (TC1043)</strong> 與 <strong>黎明路 (TC0697)</strong> 確立為常態最重嫌震央，直接緊貼日南住宅生活圈；<strong>順帆路 (TC1278)</strong> 則為下風處主要擴散邊界。</li>
    <li><strong>歷史偷排重點跟監</strong>：針對 <strong>幼四路 33號 (TC0905)</strong> 曾記錄到清晨瞬間破萬 ppb 之短波暴衝特性，建議稽查大隊將其列入重點名冊，不定期架設自動觸發採樣設備進行守株待兔式執法。</li>
  </ul>

  <!-- ── 第九章（附錄）：嚴格資料檢核 (Data QC) 規則與定義說明 ── -->
  <h2>九、附錄：嚴格資料檢核 (Data QC) 規則與定義說明</h2>
  <div class="callout callout-qc" style="border-left: 4px solid var(--green); background: rgba(52,211,153,0.06); padding: 22px; border-radius: 12px; margin: 20px 0 36px;">
    <div class="callout-title" style="font-size: 1.1rem; color: var(--green); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
      🛡️ 數據清理原則、設備剔除清冊與篩選門檻定義說明
    </div>
    <ul style="margin-left: 20px; line-height: 1.8; color: #cbd5e1; font-size: 0.95rem;">
      <li><strong>計算單位標準化</strong>：原始資料為每 1～2 分鐘 1 筆之瞬時監測值，全時序累積超過 1,500 萬筆。為消除瞬時擾動並符合宏觀趨勢分析，本報告全數轉換聚合為 <strong>每小時平均值 (Hourly Mean)</strong>，共產出 273,400 列標準時數資料。</li>
      <li><strong>設備層級篩選剔除清冊（Excluded Sensors · 共 4 台）</strong>：經全時序完整性稽核，以下 4 台設備因嚴重硬體故障或未連線，<strong>已全數予以排除</strong>，不納入統計排名與空間內插計算：
        <ol style="margin-left: 20px; margin-top: 4px; color: #94a3b8;">
          <li><code>TC0179</code> (ID: 11816167581)：100.0% 讀值恆為 0.0，且僅在線 6 天（146 小時），屬未連線無效設備。</li>
          <li><code>TC0915</code> (ID: 12201470934)：100.0% 讀值恆為 0.0（超過 80% 門檻），VOC 感測元件未接或硬體損壞。</li>
          <li><code>TC0221</code> (ID: 11849005043)：94.12% 讀值恆為 0.0（超過 80% 門檻），感測器大部分時段失效。</li>
          <li><code>TC0414</code> (ID: 12203929073)：全程 10,360 小時讀值恆定為 8.0 ppb（標準差 $\sigma = 0.0$），屬底線卡死異常設備。</li>
        </ol>
      </li>
      <li><strong>數值層級異常值過濾 (Record-level Outlier QC)</strong>：
        <ol style="margin-left: 20px; margin-top: 4px; color: #94a3b8;">
          <li><strong>VOC/TVOC</strong>：剔除微型感測器 16-bit 暫存器溢位極限 65,535 ppb、韌體截斷飽和值 29,206 ppb，以及其他超過 15,000 ppb 之極端異常突波（共剔除 4,468 筆，佔 1.63%）。</li>
          <li><strong>PM2.5</strong>：剔除缺失值（Null）與超過 500 μg/m³ 之異常突波。</li>
        </ol>
      </li>
      <li><strong>TC0905 (幼四路 33號) 設備定位修正說明</strong>：
        TC0905 在 432 天中實際僅監測 135 小時（2025/06/27～07/02，約 5.6 天）。為恪遵統計代表性，本報告<strong>不將其納入全年常態排比</strong>；但因其在線期間清晨 04:00～06:00 記錄到 14,442 ppb 之極端偷排特徵，本報告將其<strong>獨立定調為「歷史短期專案突發案例」</strong>供稽查跟監參考。</li>
      <li><strong>本報告自訂篩選門檻定義說明</strong>：
        本報告所稱「高濃度警示時數 (>200 ppb)」與「重度事件時數 (>500 ppb)」，係本研究針對大甲幼獅微感網絡背景特徵所設定之<strong>內部快篩與熱區優先序篩選門檻</strong>，用以評估熱區嚴重度與持續時數，非作為公權力裁處依據。</li>
    </ul>
  </div>

  <footer>
    委託機關：臺中市政府環境保護局 ｜ 研究分析單位：振興發科技有限公司<br>
    資料來源：自架微感 + 環境物聯網提供之 IOT 測值數據 (2025.06.27 - 2026.09.01 · 共432天全時序 · 每小時平均值計算) · 檔案版本 v3.1
  </footer>

</div>

<!-- ── Chart.js 數據驅動腳本 ── -->
<script>
const REPORT_DATA = {json.dumps(stats_data, ensure_ascii=False)};
const BOUNDARY_LATLNGS = {json.dumps(boundary_latlngs)};
const HOTSPOTS_DATA = {json.dumps(hotzones_data, ensure_ascii=False)};

document.addEventListener("DOMContentLoaded", function() {{
  renderCharts(REPORT_DATA);
  initDajiaMap(REPORT_DATA, HOTSPOTS_DATA);
}});

let mapInstance = null;
let markersMap = {{}};
let hotspotLayers = {{}};

function initDajiaMap(data, hotspots) {{
  if (!document.getElementById('dajiaMap')) return;

  mapInstance = L.map('dajiaMap').setView([24.402, 120.648], 14);

  L.tileLayer('https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png', {{
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }}).addTo(mapInstance);

  // 1. 繪製 500m 緩衝區邊界
  if (BOUNDARY_LATLNGS && BOUNDARY_LATLNGS.length > 0) {{
    const poly = L.polygon(BOUNDARY_LATLNGS, {{
      color: '#f97316',
      weight: 2,
      dashArray: '5, 5',
      fillColor: '#f97316',
      fillOpacity: 0.05
    }}).addTo(mapInstance);
    poly.bindTooltip("大甲幼獅工業區 500m 緩衝區邊界", {{ sticky: true }});
  }}

  // 2. 繪製三大可疑熱區劃設多邊形 (Hotspots Polygons)
  if (hotspots) {{
    Object.keys(hotspots).forEach(zid => {{
      const z = hotspots[zid];
      const zonePoly = L.polygon(z.polygon, {{
        color: z.color,
        weight: 2.5,
        fillColor: z.color,
        fillOpacity: 0.18,
        dashArray: zid === 'zone1' ? null : '4, 4'
      }}).addTo(mapInstance);

      const zonePopup = `
        <div style="color:#0f172a; font-family:sans-serif; min-width:220px;">
          <h4 style="margin:0 0 6px; color:${{z.color}}; border-bottom:2px solid ${{z.color}}; padding-bottom:4px;">
            ${{z.name}}
          </h4>
          <div style="font-size:12px; line-height:1.6;">
            <b>稽查優先級:</b> <span style="color:${{z.color}}; font-weight:bold;">${{z.priority}}</span><br>
            <b>涵蓋測站:</b> ${{z.sensors.join(', ')}}<br>
            <b>特徵簡述:</b> ${{z.desc}}
          </div>
        </div>
      `;
      zonePoly.bindPopup(zonePopup);
      zonePoly.bindTooltip(z.name, {{ sticky: true }});
      hotspotLayers[zid] = zonePoly;
    }});
  }}

  // 3. 繪製微感測器 Marker
  const tbody = document.getElementById('sensorsTableBody');
  if (tbody) tbody.innerHTML = '';

  data.sensors_ranking.forEach((s, idx) => {{
    const lat = s.lat;
    const lon = s.lon;
    const voc = s.voc_mean;
    const isShort = s.is_short_term;
    const color = isShort ? '#eab308' : (voc > 1000 ? '#ef4444' : (voc > 500 ? '#f97316' : '#38bdf8'));

    const marker = L.circleMarker([lat, lon], {{
      radius: voc > 1000 ? 9 : 7,
      fillColor: color,
      color: '#ffffff',
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.95
    }}).addTo(mapInstance);

    const popupHtml = `
      <div style="color:#0f172a; font-family:sans-serif; min-width:190px;">
        <h4 style="margin:0 0 6px; color:#1e293b; border-bottom:1px solid #cbd5e1; padding-bottom:4px;">
          測站：<strong>${{s.name}}</strong> ${{isShort ? '<span style="color:#eab308;font-size:11px;">[短期專案]</span>' : ''}}
        </h4>
        <div style="font-size:12px; line-height:1.6;">
          <b>設備ID:</b> ${{s.deviceId}}<br>
          <b>檢核 VOC 均值:</b> <span style="color:${{color}}; font-weight:bold;">${{s.voc_mean.toLocaleString()}} ppb</span><br>
          <b>PM2.5 均值:</b> ${{s.pm25_mean}} μg/m³<br>
          <b>P95 峰值:</b> ${{s.voc_p95.toLocaleString()}} ppb<br>
          <b>有效時數:</b> ${{s.valid_voc_hours}} 小時<br>
          <b>位置:</b> ${{s.location}}<br>
          <b>狀態:</b> ${{s.status_note}}
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml);
    markersMap[s.deviceId] = marker;

    if (tbody) {{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span style="font-weight:bold; color:#94a3b8;">${{idx + 1}}</span></td>
        <td><strong style="color:var(--heading);">${{s.name}}</strong></td>
        <td><code style="color:#94a3b8;">${{s.deviceId}}</code></td>
        <td style="color:#e2e8f0;">${{s.location || '大甲幼獅周邊'}}</td>
        <td>${{lon.toFixed(5)}}</td>
        <td>${{lat.toFixed(5)}}</td>
        <td style="color:${{color}}; font-weight:bold;">${{s.voc_mean.toLocaleString()}}</td>
        <td>${{s.pm25_mean}}</td>
        <td><span style="font-size:11px; color:#94a3b8;">${{s.valid_voc_hours}} hr · ${{s.status_note}}</span></td>
        <td>
          <button onclick="focusSensor(${{s.deviceId}}, ${{lat}}, ${{lon}})" 
                  style="background:rgba(56,189,248,0.15); border:1px solid var(--blue); color:var(--blue); border-radius:4px; padding:3px 8px; cursor:pointer; font-size:12px;">
            在地圖查看
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }}
  }});
}}

function focusHotspotZone(zoneId) {{
  if (!mapInstance || !hotspotLayers[zoneId]) return;
  const layer = hotspotLayers[zoneId];
  mapInstance.fitBounds(layer.getBounds(), {{ padding: [40, 40], animate: true }});
  layer.openPopup();
  document.getElementById('dajiaMap').scrollIntoView({{ behavior: 'smooth', block: 'center' }});
}}

function resetMapView() {{
  if (!mapInstance) return;
  mapInstance.setView([24.402, 120.648], 14, {{ animate: true }});
}}

function focusSensor(deviceId, lat, lon) {{
  if (mapInstance) {{
    mapInstance.setView([lat, lon], 16, {{ animate: true }});
    if (markersMap[deviceId]) {{
      markersMap[deviceId].openPopup();
    }}
    document.getElementById('dajiaMap').scrollIntoView({{ behavior: 'smooth', block: 'center' }});
  }}
}}

function renderCharts(data) {{
  const ranking = data.sensors_ranking;
  const top5Curve = data.top5_hourly_curve;
  const temporal = data.temporal_analysis;

  // A. 月度趨勢圖
  if (temporal && temporal.monthly) {{
    const monthLabels = temporal.monthly.map(m => m.month);
    const monthMeans = temporal.monthly.map(m => m.mean_voc);
    const monthRates = temporal.monthly.map(m => m.gt500_rate);

    new Chart(document.getElementById('chartMonthlyTrend'), {{
      type: 'bar',
      data: {{
        labels: monthLabels,
        datasets: [
          {{
            type: 'bar',
            label: '月均 VOC 濃度 (ppb)',
            data: monthMeans,
            backgroundColor: monthMeans.map(v => v > 450 ? '#ef4444' : (v > 320 ? '#f97316' : '#38bdf8')),
            borderRadius: 5,
            yAxisID: 'y'
          }},
          {{
            type: 'line',
            label: '重度污染 (>500ppb) 事件率 (%)',
            data: monthRates,
            borderColor: '#facc15',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 4,
            yAxisID: 'y1'
          }}
        ]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        scales: {{
          x: {{ grid: {{ color: '#24344d' }}, ticks: {{ color: '#cbd5e1' }} }},
          y: {{
            grid: {{ color: '#24344d' }},
            ticks: {{ color: '#cbd5e1' }},
            title: {{ display: true, text: 'VOC 濃度 (ppb)', color: '#94a3b8' }}
          }},
          y1: {{
            position: 'right',
            grid: {{ display: false }},
            ticks: {{ color: '#facc15', callback: v => v + '%' }},
            title: {{ display: true, text: '重度事件率 (%)', color: '#facc15' }}
          }}
        }},
        plugins: {{
          legend: {{ labels: {{ color: '#f8fafc' }} }}
        }}
      }}
    }});
  }}

  // B. 星期特徵圖 (週一至週日)
  if (temporal && temporal.weekday_top_months) {{
    const weekdayNames = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
    const wMeans = temporal.weekday_top_months.map(w => w.mean_voc);
    const wP95s = temporal.weekday_top_months.map(w => w.p95_voc);
    const wRates = temporal.weekday_top_months.map(w => w.gt500_rate);

    new Chart(document.getElementById('chartWeekdayPattern'), {{
      type: 'bar',
      data: {{
        labels: weekdayNames,
        datasets: [
          {{
            label: '各曜日平均 VOC (ppb · 全週差異 < 7%)',
            data: wMeans,
            backgroundColor: '#38bdf8',
            borderRadius: 6,
            yAxisID: 'y'
          }},
          {{
            type: 'line',
            label: 'P95 峰值濃度 (ppb)',
            data: wP95s,
            borderColor: '#c084fc',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            borderDash: [5, 5],
            yAxisID: 'y'
          }},
          {{
            type: 'line',
            label: '重度事件率 (%)',
            data: wRates,
            borderColor: '#facc15',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            yAxisID: 'y1'
          }}
        ]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        scales: {{
          x: {{ grid: {{ color: '#24344d' }}, ticks: {{ color: '#cbd5e1' }} }},
          y: {{
            grid: {{ color: '#24344d' }},
            ticks: {{ color: '#cbd5e1' }},
            title: {{ display: true, text: 'VOC 濃度 (ppb)', color: '#94a3b8' }}
          }},
          y1: {{
            position: 'right',
            grid: {{ display: false }},
            ticks: {{ color: '#facc15', callback: v => v + '%' }},
            title: {{ display: true, text: '重度事件率 (%)', color: '#facc15' }}
          }}
        }},
        plugins: {{
          legend: {{ labels: {{ color: '#f8fafc' }} }}
        }}
      }}
    }});
  }}

  // C. 4小時時段區間圖 (6個時段)
  if (temporal && temporal.time_blocks) {{
    const blockLabels = temporal.time_blocks.map(b => b.time_block.split(' ')[0]);
    const blockMeans = temporal.time_blocks.map(b => b.mean_voc);
    const blockGt500 = temporal.time_blocks.map(b => b.gt500_rate);

    new Chart(document.getElementById('chartTimeBlockPattern'), {{
      type: 'bar',
      data: {{
        labels: blockLabels,
        datasets: [
          {{
            label: '平均 VOC (ppb)',
            data: blockMeans,
            backgroundColor: blockMeans.map(v => v > 450 ? '#ef4444' : (v > 300 ? '#f97316' : '#38bdf8')),
            borderRadius: 6,
            yAxisID: 'y'
          }},
          {{
            type: 'line',
            label: '重度事件發生率 (%)',
            data: blockGt500,
            borderColor: '#facc15',
            backgroundColor: 'transparent',
            borderWidth: 3,
            tension: 0.35,
            pointRadius: 5,
            yAxisID: 'y1'
          }}
        ]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        scales: {{
          x: {{ grid: {{ color: '#24344d' }}, ticks: {{ color: '#cbd5e1', font: {{ weight: 'bold' }} }} }},
          y: {{
            grid: {{ color: '#24344d' }},
            ticks: {{ color: '#cbd5e1' }},
            title: {{ display: true, text: '平均 VOC 濃度 (ppb)', color: '#94a3b8' }}
          }},
          y1: {{
            position: 'right',
            grid: {{ display: false }},
            ticks: {{ color: '#facc15', callback: v => v + '%' }},
            title: {{ display: true, text: '重度事件率 (%)', color: '#facc15' }}
          }}
        }},
        plugins: {{
          legend: {{ labels: {{ color: '#f8fafc' }} }}
        }}
      }}
    }});
  }}

  // 1. VOC 排行長條圖 (排除短期設備，以長期有效測站前 15 名展現)
  const longTerm = ranking.filter(s => !s.is_short_term);
  const top15 = longTerm.slice(0, 15);
  const labelsVoc = top15.map(s => `${{s.name}} (${{s.location.slice(0, 7)}})`);
  const valuesVoc = top15.map(s => s.voc_mean);
  const bgColorsVoc = valuesVoc.map(v => v > 1000 ? '#ef4444' : (v > 500 ? '#f97316' : '#38bdf8'));

  new Chart(document.getElementById('chartVocRanking'), {{
    type: 'bar',
    data: {{
      labels: labelsVoc,
      datasets: [{{
        label: '檢核 VOC 年均濃度 (ppb · 小時平均)',
        data: valuesVoc,
        backgroundColor: bgColorsVoc,
        borderRadius: 6
      }}]
    }},
    options: {{
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {{
        legend: {{ display: false }},
        tooltip: {{
          callbacks: {{
            label: (ctx) => ` 檢核年均: ${{ctx.raw.toLocaleString()}} ppb (小時均值)`
          }}
        }}
      }},
      scales: {{
        x: {{
          grid: {{ color: '#24344d' }},
          ticks: {{ color: '#cbd5e1' }},
          title: {{ display: true, text: '每小時平均濃度 (ppb)', color: '#94a3b8' }}
        }},
        y: {{
          grid: {{ display: false }},
          ticks: {{ color: '#f8fafc', font: {{ weight: 'bold' }} }}
        }}
      }}
    }}
  }});

  // 2. 24 小時時序曲線圖 (常態 Top 5 + TC0905 歷史對照)
  const hours = Array.from({{length: 24}}, (_, i) => `${{i.toString().padStart(2, '0')}}:00`);
  const curveColors = {{
    'TC1043': '#ef4444',
    'TC0697': '#f97316',
    'TC1278': '#a855f7',
    'TC0676': '#38bdf8',
    'TC0913': '#34d399',
    'TC0905': '#facc15'
  }};

  const curveLabels = {{
    'TC1043': 'TC1043 (最高均值/東南中山路)',
    'TC0697': 'TC0697 (傍晚高峰/幸福里)',
    'TC1278': 'TC1278 (清晨高峰/順帆路)',
    'TC0676': 'TC0676 (清晨高峰/中山路二段912巷)',
    'TC0913': 'TC0913 (夜間高值/東側邊界)',
    'TC0905': 'TC0905 (歷史短期專案/清晨暴衝)'
  }};

  const curveDatasets = Object.keys(top5Curve).map(k => ({{
    label: curveLabels[k] || k,
    data: top5Curve[k],
    borderColor: curveColors[k] || '#cbd5e1',
    backgroundColor: 'transparent',
    borderWidth: k === 'TC1043' || k === 'TC0905' ? 3.5 : 2,
    borderDash: k === 'TC0905' ? [6, 4] : [],
    tension: 0.35,
    pointRadius: 3,
    pointHoverRadius: 6
  }}));

  new Chart(document.getElementById('chartHourlyCurve'), {{
    type: 'line',
    data: {{
      labels: hours,
      datasets: curveDatasets
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      plugins: {{
        legend: {{
          labels: {{ color: '#f8fafc', boxWidth: 14 }}
        }},
        tooltip: {{
          callbacks: {{
            label: (ctx) => ` ${{ctx.dataset.label}}: ${{ctx.raw.toLocaleString()}} ppb`
          }}
        }}
      }},
      scales: {{
        x: {{
          grid: {{ color: '#24344d' }},
          ticks: {{ color: '#cbd5e1' }},
          title: {{ display: true, text: '時刻 (整點)', color: '#94a3b8' }}
        }},
        y: {{
          grid: {{ color: '#24344d' }},
          ticks: {{ color: '#cbd5e1' }},
          title: {{ display: true, text: '每小時平均 VOC (ppb)', color: '#94a3b8' }}
        }}
      }}
    }}
  }});

  // 3. 警示時數結構分析 (Top 5 長期測站)
  const top5Sensors = longTerm.slice(0, 5);
  new Chart(document.getElementById('chartThresholdStacked'), {{
    type: 'bar',
    data: {{
      labels: top5Sensors.map(s => s.name),
      datasets: [
        {{
          label: '極重度事件 (>1,000 ppb) 時數',
          data: top5Sensors.map(s => s.voc_gt1000),
          backgroundColor: '#ef4444'
        }},
        {{
          label: '重度事件 (500~1,000 ppb) 時數',
          data: top5Sensors.map(s => s.voc_gt500 - s.voc_gt1000),
          backgroundColor: '#f97316'
        }},
        {{
          label: '警示事件 (200~500 ppb) 時數',
          data: top5Sensors.map(s => s.voc_gt200 - s.voc_gt500),
          backgroundColor: '#38bdf8'
        }}
      ]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      scales: {{
        x: {{ stacked: true, ticks: {{ color: '#f8fafc' }}, grid: {{ display: false }} }},
        y: {{ stacked: true, ticks: {{ color: '#cbd5e1' }}, grid: {{ color: '#24344d' }}, title: {{ display: true, text: '累計警示時數 (hr)', color: '#94a3b8' }} }}
      }},
      plugins: {{
        legend: {{ labels: {{ color: '#f8fafc', font: {{ size: 11 }} }} }}
      }}
    }}
  }});

  // 4. PM2.5 與 VOC 關聯散佈圖
  new Chart(document.getElementById('chartScatterMatrix'), {{
    type: 'scatter',
    data: {{
      datasets: [{{
        label: '微感測器 (31台有效)',
        data: ranking.map(s => ({{ x: s.pm25_mean, y: s.voc_mean, name: s.name, short: s.is_short_term }})),
        backgroundColor: ranking.map(s => s.is_short_term ? '#eab308' : (s.voc_mean > 1000 ? '#ef4444' : (s.voc_mean > 500 ? '#f97316' : '#38bdf8'))),
        pointRadius: ranking.map(s => s.voc_mean > 1000 ? 9 : 6),
        pointHoverRadius: 11
      }}]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      scales: {{
        x: {{
          ticks: {{ color: '#cbd5e1' }},
          grid: {{ color: '#24344d' }},
          title: {{ display: true, text: 'PM2.5 檢核均值 (μg/m³)', color: '#94a3b8' }}
        }},
        y: {{
          ticks: {{ color: '#cbd5e1' }},
          grid: {{ color: '#24344d' }},
          title: {{ display: true, text: 'VOC 檢核均值 (ppb)', color: '#94a3b8' }}
        }}
      }},
      plugins: {{
        legend: {{ display: false }},
        tooltip: {{
          callbacks: {{
            label: (ctx) => ` 測站 ${{ctx.raw.name}}: PM2.5 = ${{ctx.raw.x}} μg/m³, VOC = ${{ctx.raw.y.toLocaleString()}} ppb${{ctx.raw.short ? ' [短期專案]' : ''}}`
          }}
        }}
      }}
    }}
  }});
}}
</script>
</body>
</html>
"""

with open(HTML_PATH, "w", encoding="utf-8") as f:
    f.write(new_html)

print("✅ 大甲幼獅報告 HTML 更新完畢！已刪除原第八章 SOP，地圖已劃設三大熱區並具備卡片雙向連動。")
