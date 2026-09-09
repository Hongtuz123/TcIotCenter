# -*- coding: utf-8 -*-
"""
將 dajia_stats_for_report.json 數據直接內嵌至 10_Dajia_Odor_VOC_Hotspot_Investigation_Report.html
徹底解決瀏覽器在 file:// 協議下阻擋 local fetch (CORS) 導致圖表空白的問題。
"""
import os
import json

BASE_DIR = r"C:\GoogleAntigravity\2026IoTcenter"
JSON_PATH = os.path.join(BASE_DIR, "documents", "figures", "dajia_stats_for_report.json")
HTML_PATH = os.path.join(BASE_DIR, "documents", "10_Dajia_Odor_VOC_Hotspot_Investigation_Report.html")

with open(JSON_PATH, "r", encoding="utf-8") as f:
    stats_data = json.load(f)

json_str = json.dumps(stats_data, ensure_ascii=False)

with open(HTML_PATH, "r", encoding="utf-8") as f:
    html_content = f.read()

# 尋找 <script> 到 renderCharts(data) 的開頭
old_block = """<script>
document.addEventListener("DOMContentLoaded", function() {
  // 載入後台 JSON 數據渲染圖表
  fetch("figures/dajia_stats_for_report.json")
    .then(r => r.json())
    .then(data => {
      renderCharts(data);
    })
    .catch(err => {
      console.warn("無法動態載入 JSON，使用內建備份數據渲染", err);
      renderChartsFallback();
    });
});"""

new_block = f"""<script>
// 內嵌完整觀測統計數據，確保在本地 file:// 協議下直接雙擊瀏覽器亦可 100% 離線渲染
const REPORT_DATA = {json_str};

document.addEventListener("DOMContentLoaded", function() {{
  renderCharts(REPORT_DATA);
}});"""

if old_block in html_content:
    html_content = html_content.replace(old_block, new_block)
    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(html_content)
    print("✅ 成功將統計數據內嵌至 HTML，完美支援本地 file:// 直接開啟！")
else:
    print("⚠️ 找不到目標替換區塊，檢查檔案內容。")
