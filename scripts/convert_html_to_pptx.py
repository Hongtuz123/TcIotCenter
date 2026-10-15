# -*- coding: utf-8 -*-
"""
完全 1:1 還原 output/AI_IoT_Project_Experience_Sharing.html
不改任何資料與格式，精準轉換為 PowerPoint 簡報 (.pptx)
"""

import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "output")
TARGET_FILE = os.path.join(OUT_DIR, "AI_IoT_Project_Experience_Sharing.pptx")
BACKUP_FILE = os.path.join(OUT_DIR, "AI_IoT_Project_Experience_Sharing_new.pptx")

# 顏色定義（完全比照 HTML CSS 變數）
C_BG = RGBColor(11, 15, 25)          # --bg-dark: #0b0f19
C_CARD = RGBColor(22, 30, 46)        # --bg-card: #161e2e
C_CARD_ALT = RGBColor(18, 24, 38)    # --bg-card-alt: #121826
C_TERM = RGBColor(10, 14, 23)        # --bg-terminal: #0a0e17
C_BORDER = RGBColor(40, 53, 76)      # --border: #28354c
C_ORANGE = RGBColor(249, 115, 22)    # --primary: #f97316
C_BLUE = RGBColor(56, 189, 248)      # --blue: #38bdf8
C_GREEN = RGBColor(74, 222, 128)     # --green: #4ade80
C_RED = RGBColor(248, 113, 113)      # --red: #f87171
C_YELLOW = RGBColor(250, 204, 21)    # --yellow: #facc15
C_PURPLE = RGBColor(192, 132, 252)   # --purple: #c084fc
C_TEXT = RGBColor(248, 250, 252)     # --text-main: #f8fafc
C_MUTED = RGBColor(148, 163, 184)    # --text-muted: #94a3b8

FONT_HEADING = "Microsoft JhengHei"
FONT_BODY = "Microsoft JhengHei"
FONT_CODE = "Consolas"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
TOTAL_SLIDES = 12

def create_slide():
    s = prs.slides.add_slide(BLANK)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = C_BG
    bg.line.fill.background()
    return s

def add_box(slide, x, y, w, h, fill=C_CARD, border=C_BORDER, width=1.0, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    if border is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = border
        s.line.width = Pt(width)
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = 0.05
    return s

def add_header(slide, tag_text, title_text, subtitle_text=""):
    # Tag
    badge = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.4), Inches(2.8), Inches(0.32))
    badge.fill.solid()
    badge.fill.fore_color.rgb = C_CARD
    badge.line.color.rgb = C_ORANGE
    badge.line.width = Pt(1)
    badge.adjustments[0] = 0.5
    tf = badge.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = tag_text
    p.font.name = FONT_HEADING
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = C_ORANGE
    p.alignment = PP_ALIGN.CENTER

    # Title & Subtitle
    tx = slide.shapes.add_textbox(Inches(0.8), Inches(0.75), Inches(11.733), Inches(0.95))
    tf = tx.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.text = title_text
    p.font.name = FONT_HEADING
    p.font.size = Pt(21)
    p.font.bold = True
    p.font.color.rgb = C_TEXT

    if subtitle_text:
        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.name = FONT_BODY
        p2.font.size = Pt(12)
        p2.font.color.rgb = C_BLUE
        p2.space_before = Pt(3)

def add_footer(slide, current_idx):
    tx = slide.shapes.add_textbox(Inches(0.8), Inches(7.05), Inches(11.733), Inches(0.35))
    tf = tx.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = f"臺中市產業園區微感監測中心 (TC IoT Center) ｜ 投影片 {current_idx} / {TOTAL_SLIDES}"
    p.font.name = FONT_BODY
    p.font.size = Pt(9.5)
    p.font.color.rgb = C_MUTED
    p.alignment = PP_ALIGN.RIGHT

# ==============================================================================
# SLIDE 1: 封面
# ==============================================================================
s1 = create_slide()
add_box(s1, 0.8, 0.8, 11.733, 5.9, fill=C_CARD, border=C_ORANGE, width=1.5)

# Tag
tb = s1.shapes.add_textbox(Inches(1.2), Inches(1.15), Inches(10), Inches(0.4))
p = tb.text_frame.paragraphs[0]
p.text = "⚡ 軟體架構重構 × AI 協同實戰全景"
p.font.name = FONT_HEADING; p.font.size = Pt(13); p.font.bold = True; p.font.color.rgb = C_ORANGE

# Main Title
tb = s1.shapes.add_textbox(Inches(1.2), Inches(1.65), Inches(10.9), Inches(1.8))
tf = tb.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "從問題出發的系統架構思考：\nTC IoT Center 專案與 AI 協同開發實戰經驗"
p.font.name = FONT_HEADING; p.font.size = Pt(32); p.font.bold = True; p.font.color.rgb = C_TEXT
p.space_after = Pt(8)

p2 = tf.add_paragraph()
p2.text = "—— 1 個人如何透過「問題推導鏈」引導 AI，打造工業級微感監測中心"
p2.font.name = FONT_BODY; p2.font.size = Pt(15); p2.font.color.rgb = C_BLUE

# Quote / Core Questions Card
add_box(s1, 1.2, 3.8, 10.933, 1.85, fill=C_TERM, border=C_BORDER)
tb = s1.shapes.add_textbox(Inches(1.4), Inches(3.9), Inches(10.5), Inches(1.65))
tf = tb.text_frame
tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🎯 本次分享的核心靈魂拷問："
p.font.name = FONT_HEADING; p.font.size = Pt(13); p.font.bold = True; p.font.color.rgb = C_GREEN
p.space_after = Pt(6)

pts = [
    ("1. 真實痛點：", "遭遇了什麼傳統架構無法解決的高頻與大數據災難？"),
    ("2. 人機碰撞：", "如何提出邊界約束，逼 AI 產出輕量且高容錯的演算法？"),
    ("3. 踩剎車校正：", "面對 AI 的物理胡謅與極限崩潰，工程師如何精準修正？")
]
for prefix, text_val in pts:
    p = tf.add_paragraph()
    p.text = prefix + " " + text_val
    p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.color.rgb = C_MUTED
    p.space_after = Pt(3)

# Footer Specs
tb = s1.shapes.add_textbox(Inches(1.2), Inches(5.9), Inches(10.9), Inches(0.4))
tf = tb.text_frame
p = tf.paragraphs[0]
p.text = "規模：全臺中 20 園區 · 1,401 支微感器  |  交付：9 套技術規格書 · 百萬級大數據分析報告  |  架構：Next.js 16 · 3D Mapbox · 高斯煙團粒子"
p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.color.rgb = C_MUTED

add_footer(s1, 1)

# ==============================================================================
# SLIDE 2: 殘酷現狀 (5 個痛點卡片)
# ==============================================================================
s2 = create_slide()
add_header(s2, "01. 殘酷現狀", "起點：海量數據下的五大真實工程噩夢", "在導入 AI 之前，這是一場看似不可能單人完成的高負載混亂")

pain_cards = [
    ("🚨 痛點 1", "警報疲勞 (Alert Fatigue)", "1,400 站每 5 分鐘連續上傳，路過柴油車或施工揚塵天天觸發誤報。一天跳 400 則警報，稽查大隊直接麻木關靜音！", "缺乏空間連續性", C_RED),
    ("🌪️ 痛點 2", "擴散黑盒子 (Blackbox)", "測站數值爆表，但長官與居民只問「煙往哪飄？誰會吸到？」。傳統 CFD / WRF 模式算一次要 2 小時，根本無法現場即時作戰！", "計算開銷過大", C_ORANGE),
    ("💥 痛點 3", "連線脆弱 (Fragility)", "雲端 Supabase 或外網只要稍有網路抖動，前端直接 500 白畫面死給業主看，缺乏離線與本地降級防線！", "單點故障 (SPOF)", C_YELLOW),
    ("⏳ 痛點 4", "百萬資料卡死 (Bottleneck)", "15 個月累積龐大連續紀錄，前端點擊園區歷史報表後台 CPU 100% 癱瘓轉圈圈，記憶體洩漏 (OOM) 頻傳！", "未做時序預聚合", C_BLUE),
    ("🗣️ 痛點 5", "民怨缺乏鐵證 (No Proof)", "大甲幼獅夜間異味陳情頻繁，白天稽查撲空被罵官商勾結，拿不出具法律公信力的微氣象逆風溯源科學證據！", "無公信力報告", C_PURPLE)
]

for i, (num_tag, title_text, desc, bottom_tag, color) in enumerate(pain_cards):
    x = 0.8 + i * 2.38
    add_box(s2, x, 1.85, 2.22, 5.0, fill=C_CARD, border=color, width=1.2)
    
    # Tag
    tb = s2.shapes.add_textbox(Inches(x + 0.1), Inches(1.95), Inches(2.02), Inches(0.4))
    p = tb.text_frame.paragraphs[0]
    p.text = num_tag
    p.font.name = FONT_HEADING; p.font.size = Pt(12); p.font.bold = True; p.font.color.rgb = color
    
    # Title
    tb = s2.shapes.add_textbox(Inches(x + 0.1), Inches(2.35), Inches(2.02), Inches(0.75))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title_text
    p.font.name = FONT_HEADING; p.font.size = Pt(13); p.font.bold = True; p.font.color.rgb = C_TEXT
    
    # Desc
    tb = s2.shapes.add_textbox(Inches(x + 0.1), Inches(3.2), Inches(2.02), Inches(2.8))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = desc
    p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.color.rgb = C_MUTED
    
    # Bottom Badge
    bb = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x + 0.15), Inches(6.15), Inches(1.92), Inches(0.45))
    bb.fill.solid(); bb.fill.fore_color.rgb = C_TERM
    bb.line.color.rgb = color; bb.line.width = Pt(1)
    tf = bb.text_frame
    p = tf.paragraphs[0]
    p.text = "✕ " + bottom_tag
    p.font.name = FONT_BODY; p.font.size = Pt(10); p.font.bold = True; p.font.color.rgb = color
    p.alignment = PP_ALIGN.CENTER

add_footer(s2, 2)

# ==============================================================================
# SLIDE 3: 核心思考 ① (空間聚類防抖)
# ==============================================================================
s3 = create_slide()
add_header(s3, "02. 核心思考 ①", "問題：單站爆表＝真污染？如何消滅警報疲勞？", "思考推導 ➔ 與 AI 碰撞辯論 ➔ Haversine 空間聚類演算法誕生")

# 左：痛點與根源剖析
add_box(s3, 0.8, 1.85, 3.6, 5.0, fill=C_CARD, border=C_RED, width=1.2)
tb = s3.shapes.add_textbox(Inches(0.95), Inches(1.95), Inches(3.3), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🔴 痛點與根源剖析"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_RED
p.space_after = Pt(8)

items_left = [
    ("• 傳統做法：", "if (pm25 > 50) triggerAlert()"),
    ("• 致命缺點：", "單一測站極易受機車廢氣、烤肉、工程擾動干擾。"),
    ("• 後果：", "單日破百則警報，公務員直接麻痺，系統喪失公信力！"),
    ("", ""),
    ("💡 核心物理假設：", "真實的工廠廢氣排放，在物理空間上必然具備擴散連續性與時間持久性！")
]
for h, b in items_left:
    if h:
        p = tf.add_paragraph()
        p.text = h + " " + b
        p.font.name = FONT_BODY; p.font.size = Pt(11.5)
        p.font.color.rgb = C_TEXT if "💡" in h else C_MUTED
        p.font.bold = True if "💡" in h else False
        p.space_after = Pt(6)

# 中：人機對話窗 (Prompt 演化)
add_box(s3, 4.6, 1.85, 4.4, 5.0, fill=C_TERM, border=C_BLUE, width=1.2)
tb = s3.shapes.add_textbox(Inches(4.75), Inches(1.95), Inches(4.1), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "💻 Claude 3.7 Sonnet (Thinking) — Iteration Prompt"
p.font.name = FONT_CODE; p.font.size = Pt(11.5); p.font.bold = True; p.font.color.rgb = C_BLUE
p.space_after = Pt(8)

dialog = [
    ("USER >", "「我們要過濾單站雜訊，只抓真實群聚事件，怎麼做？」", C_TEXT),
    ("AI >", "「建議採用標準 DBSCAN 演算法做空間密度聚類，eps=1.5km, minPts=3。」", C_MUTED),
    ("USER (踩剎車質疑) >", "「DBSCAN 在 Node.js 每 5 分鐘算 1,400 站開銷太高，且未考慮時間防抖。請設計輕量化版本！」", C_ORANGE),
    ("AI (收斂落地) >", "「改用 Haversine 距離矩陣 + 5分鐘時間桶滑動窗。連續 3 筆超標才成為 Seed，以 1.5km 半徑聚合 Seed 站點！」", C_GREEN)
]
for who, msg, col in dialog:
    p = tf.add_paragraph()
    p.text = who
    p.font.name = FONT_CODE; p.font.size = Pt(10.5); p.font.bold = True; p.font.color.rgb = col
    p2 = tf.add_paragraph()
    p2.text = msg
    p2.font.name = FONT_BODY; p2.font.size = Pt(10); p2.font.color.rgb = C_MUTED
    p2.space_after = Pt(6)

# 右：落地成果與效益
add_box(s3, 9.2, 1.85, 3.333, 5.0, fill=C_CARD, border=C_GREEN, width=1.2)
tb = s3.shapes.add_textbox(Inches(9.35), Inches(1.95), Inches(3.033), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🟢 落地成果與效益"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_GREEN
p.space_after = Pt(8)

items_right = [
    ("• 落實功能：", "anomalies/route.ts 自動聚合生成 Cluster 空間告警多邊形。"),
    ("• 防抖機制：", "連續超標 15 分鐘才發布高階告警。"),
    ("• 實測數據：", "誤報率驟降 88%！"),
    ("", ""),
    ("🎯 人類工程師的價值：", "AI 初始提案往往教科書化，工程師必須給予「延遲上限與物理常識」，逼 AI 產出輕量架構！")
]
for h, b in items_right:
    if h:
        p = tf.add_paragraph()
        p.text = h + " " + b
        p.font.name = FONT_BODY; p.font.size = Pt(11.5)
        p.font.color.rgb = C_TEXT if "🎯" in h else C_MUTED
        p.font.bold = True if "🎯" in h else False
        p.space_after = Pt(6)

add_footer(s3, 3)

# ==============================================================================
# SLIDE 4: 核心思考 ② (高斯大氣擴散)
# ==============================================================================
s4 = create_slide()
add_header(s4, "03. 核心思考 ②", "問題：煙往哪飄？瀏覽器能跑流體力學嗎？", "將重型大氣模式轉化為前端 60 FPS 動態高斯煙團粒子")

# 上半部：物理思考與公式
add_box(s4, 0.8, 1.85, 11.733, 2.3, fill=C_CARD, border=C_PURPLE, width=1.2)
tb = s4.shapes.add_textbox(Inches(1.0), Inches(1.95), Inches(11.3), Inches(2.0))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🔬 物理思考：為什麼不能直接在雲端跑 CFD / WRF 模式？"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_PURPLE
p.space_after = Pt(4)

p2 = tf.add_paragraph()
p2.text = "傳統流體力學軟體運算一次動輒數小時，稽查人員站在現場根本等不了！\n" \
          "我們與 AI 探討：如何將大氣擴散偏微分方程降維到 WebGL / Canvas 前端即時運算？\n" \
          "➔ 採用高斯煙羽模型：以風向風速與日夜大氣穩定度 (A~F級)，動態計算擴散半徑 σy, σz。\n" \
          "   C(x,y,z) = (Q / 2π·u·σy·σz) × exp(-y² / 2σy²) · exp(-z² / 2σz²)"
p2.font.name = FONT_BODY; p2.font.size = Pt(11.5); p2.font.color.rgb = C_TEXT

# 下半部左：人類審查抓出的 AI 致命物理 Bug
add_box(s4, 0.8, 4.3, 5.7, 2.55, fill=C_TERM, border=C_RED, width=1.2)
tb = s4.shapes.add_textbox(Inches(0.95), Inches(4.4), Inches(5.4), Inches(2.3))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "⚠️ 人類審查抓出的 AI 致命物理 Bug"
p.font.name = FONT_HEADING; p.font.size = Pt(14); p.font.bold = True; p.font.color.rgb = C_RED
p.space_after = Pt(4)

bugs = [
    "1. 除以零崩潰：當風速 u 接近 0 (無風微風)，分母為 0，前端直接噴 NaN 白畫面！",
    "2. 逆風擴散荒謬：純數學公式在 x < 0 時未做半平面約束，煙竟然往風吹來的方向倒流！",
    "3. 地形穿透穿牆：煙團無視大肚山地形，直接穿過山脊，嚴重脫離物理真實。"
]
for b in bugs:
    p = tf.add_paragraph()
    p.text = b; p.font.name = FONT_BODY; p.font.size = Pt(10.5); p.font.color.rgb = C_MUTED
    p.space_after = Pt(3)

# 下半部右：人機協作修正與創新落地
add_box(s4, 6.833, 4.3, 5.7, 2.55, fill=C_CARD, border=C_GREEN, width=1.2)
tb = s4.shapes.add_textbox(Inches(7.0), Inches(4.4), Inches(5.4), Inches(2.3))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🛡️ 人機協作修正與創新落地"
p.font.name = FONT_HEADING; p.font.size = Pt(14); p.font.bold = True; p.font.color.rgb = C_GREEN
p.space_after = Pt(4)

solves = [
    "✔ 風速保護閥：加入 Math.max(u, 0.5)，徹底杜絕零除數崩潰。",
    "✔ 順風半平面截斷：在向量點積判定 x < 0 處強制指數衰減至 0。",
    "✔ 8-step Ray-Casting 地形阻擋：利用 Mapbox DEM 實現迎風坡滯流堆積。",
    "✨ 成果：useDispersionSim.ts 前端 60 FPS 渲染 24 層即時煙團粒子！"
]
for s in solves:
    p = tf.add_paragraph()
    p.text = s; p.font.name = FONT_BODY; p.font.size = Pt(10.5); p.font.color.rgb = C_TEXT
    p.space_after = Pt(3)

add_footer(s4, 4)

# ==============================================================================
# SLIDE 5: 核心思考 ③ (三軌降級防線)
# ==============================================================================
s5 = create_slide()
add_header(s5, "04. 核心思考 ③", "問題：連線必會斷！如何讓系統做到絕對不掛？", "防禦性架構：引導 AI 寫出 Supabase ➔ SQLite ➔ Mock 三軌降級防線")

tiers = [
    ("Tier 1 · 生產主線", "雲端 Supabase (PostgreSQL)", "日常線上高頻串流",
     ["• 處理 1,401 支感測器 5 分鐘高頻資料寫入",
      "• 提供全域超標事件廣播與關聯查詢",
      "• 潛在災難：外網中斷、連線數超載 (Pool Exhaustion)、API 逾時 (504)",
      "• 觸發條件：網路連線正常 (ping < 200ms)"], C_BLUE),
    ("Tier 2 · 自動熱接管", "本地 iot.db (SQLite WAL)", "本機零網路高可用防線",
     ["• 本機常駐 200MB SQLite 資料庫",
      "• 啟用 WAL (Write-Ahead Logging) 模式",
      "• 設定 5 秒 Busy Timeout 防止並行鎖死",
      "• 成效：無網狀態下查詢延遲僅 5ms，比雲端更快！",
      "• 觸發條件：雲端請求 Timeout > 3000ms"], C_YELLOW),
    ("Tier 3 · 終極保底", "In-Memory Mock Snapshot", "記憶體預載快照",
     ["• 記憶體預載靜態測站結構快照",
      "• 即使硬碟滿載、檔案鎖死、DB 全崩潰",
      "• 前端 UI 依舊 100% 正常渲染核心地圖",
      "• 鐵律：絕不向業主長官呈現 500 白畫面！",
      "💡 心法：命令 AI 預想每一步都會失敗，寫出逃生通道！"], C_GREEN)
]

for i, (tag, title, sub, bullets, color) in enumerate(tiers):
    x = 0.8 + i * 4.0
    add_box(s5, x, 1.85, 3.733, 5.0, fill=C_CARD, border=color, width=1.2)
    
    tb = s5.shapes.add_textbox(Inches(x + 0.15), Inches(1.95), Inches(3.433), Inches(4.7))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = tag
    p.font.name = FONT_HEADING; p.font.size = Pt(13); p.font.bold = True; p.font.color.rgb = color
    p.space_after = Pt(2)

    p_title = tf.add_paragraph()
    p_title.text = title
    p_title.font.name = FONT_HEADING; p_title.font.size = Pt(14); p_title.font.bold = True; p_title.font.color.rgb = C_TEXT
    
    p_sub = tf.add_paragraph()
    p_sub.text = sub
    p_sub.font.name = FONT_BODY; p_sub.font.size = Pt(11); p_sub.font.color.rgb = C_BLUE
    p_sub.space_after = Pt(8)

    for b in bullets:
        p = tf.add_paragraph()
        p.text = b
        p.font.name = FONT_BODY; p.font.size = Pt(10.5)
        p.font.color.rgb = C_ORANGE if "💡" in b else C_MUTED
        p.font.bold = True if "💡" in b else False
        p.space_after = Pt(4)

add_footer(s5, 5)

# ==============================================================================
# SLIDE 6: 核心思考 ④ (百萬資料預聚合)
# ==============================================================================
s6 = create_slide()
add_header(s6, "05. 核心思考 ④", "問題：百萬筆歷史大數據，網頁一開就轉圈圈？", "空間換時間：AI 協同設計 Python 離線預聚合 Pipeline")

# 左：錯誤直覺
add_box(s6, 0.8, 1.85, 5.7, 5.0, fill=C_CARD, border=C_RED, width=1.2)
tb = s6.shapes.add_textbox(Inches(1.0), Inches(1.95), Inches(5.3), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🔴 錯誤直覺：在 Web API 裡做即時計算"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_RED
p.space_after = Pt(6)

lines_left = [
    "• 2025/06 ~ 2026/09 累積超過數百萬筆連續監測紀錄。",
    "• 每次點擊「20 園區時序熱力分析」，後端都跑：",
    "  SELECT zone, date_trunc('hour', time), AVG(pm25)\n  FROM sensor_logs GROUP BY 1, 2;",
    "• 嚴重後果：",
    "  ❌ 查詢耗時長達 8 ~ 15 秒",
    "  ❌ 3 人同時打開儀表板，Node.js 伺服器 CPU 100% 癱瘓",
    "  ❌ 使用者以為系統死機，體驗極度挫折！",
    "",
    "💡 工程反思：",
    "「已發生的歷史資料，為什麼每次都要重算？」"
]
for ln in lines_left:
    p = tf.add_paragraph()
    p.text = ln
    p.font.name = FONT_CODE if "SELECT" in ln else FONT_BODY
    p.font.size = Pt(10.5) if "SELECT" in ln else Pt(11)
    p.font.color.rgb = C_YELLOW if "SELECT" in ln else (C_TEXT if "💡" in ln else C_MUTED)
    p.font.bold = True if "💡" in ln else False
    p.space_after = Pt(3)

# 右：AI 協同預聚合 Pipeline
add_box(s6, 6.833, 1.85, 5.7, 5.0, fill=C_CARD, border=C_GREEN, width=1.2)
tb = s6.shapes.add_textbox(Inches(7.0), Inches(1.95), Inches(5.3), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🟢 AI 協同設計：離線預聚合 Pipeline"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_GREEN
p.space_after = Pt(6)

lines_right = [
    "• 夜間離線批次腳本：\n  由 compute_zone_rankings.py 在離線時段完成空間與時間多維聚合。",
    "• 嚴重度加權演算法：\n  預先計算超標時數、嚴重度指數、風場主導向與污染高風險時段。",
    "• 極致壓縮靜態快照：\n  匯出為僅 280 KB 的 zone_rankings.json，放入靜態 CDN 快取。",
    "",
    "🚀 效能奇蹟：",
    "前端 20 園區熱力圖載入時間從 12,000 ms 暴降至 35 ms！",
    "伺服器 CPU 負載接近 0%，完美實現空間換時間。"
]
for ln in lines_right:
    p = tf.add_paragraph()
    p.text = ln
    p.font.name = FONT_BODY; p.font.size = Pt(11)
    p.font.color.rgb = C_GREEN if "🚀" in ln or "35 ms" in ln else C_TEXT
    p.font.bold = True if "🚀" in ln or "35 ms" in ln else False
    p.space_after = Pt(4)

add_footer(s6, 6)

# ==============================================================================
# SLIDE 7: 核心思考 ⑤ (大甲幼獅異味調查)
# ==============================================================================
s7 = create_slide()
add_header(s7, "06. 核心思考 ⑤", "問題：深夜偷排民怨沸騰，如何拿出科學鐵證？", "大甲幼獅異味調查：從感測數據到政策級調查報告的實戰溯源")

dajia_steps = [
    ("Step 1. 民怨特徵", "白天稽查無效", "大甲幼獅園區周邊居民頻繁陳情夜間聞到刺鼻塑膠與酸臭味。但環保稽查員白天抵達時，測站數值與現場完全無異狀，被罵官商勾結。", C_RED),
    ("Step 2. 時序矩陣分析", "逆溫層規律確立", "引導 AI 跑 15 個月時段分佈熱力圖，赫然抓出異味異常 100% 集中於「深夜 22:00 ~ 凌晨 04:00」！進一步比對氣象局資料，發現該時段逢大氣逆溫層，煙霧被壓在地表無法擴散。", C_ORANGE),
    ("Step 3. 風向扇形逆溯", "扇形交叉鎖定", "AI 串聯微氣象風花圖（東南風 135°），從連續超標的 4 個受害測站沿著上風處繪製扇形錐體。在多點錐體幾何交集處，精準鎖定特定 2 家壓鑄與塗裝製程工廠！", C_BLUE),
    ("Step 4. 政策調查報告", "4 小時產出鐵證", "人機協同 4 小時完成《10_Dajia_Report_最新版.docx》，具備統計顯著性分析 (p < 0.01)，包含雷達熱點圖與法規條文對照，直接成為稽查大隊夜間精準出擊的告發鐵證！", C_GREEN)
]

for i, (st_num, badge_t, desc_t, col) in enumerate(dajia_steps):
    y = 1.85 + i * 1.25
    add_box(s7, 0.8, y, 11.733, 1.15, fill=C_CARD, border=col, width=1.2)
    
    # Left tag
    tb = s7.shapes.add_textbox(Inches(1.0), Inches(y + 0.1), Inches(3.2), Inches(0.95))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = st_num
    p.font.name = FONT_HEADING; p.font.size = Pt(14); p.font.bold = True; p.font.color.rgb = col
    
    p2 = tf.add_paragraph()
    p2.text = "● " + badge_t
    p2.font.name = FONT_BODY; p2.font.size = Pt(11); p2.font.bold = True; p2.font.color.rgb = C_TEXT
    
    # Right desc
    tb2 = s7.shapes.add_textbox(Inches(4.4), Inches(y + 0.1), Inches(7.9), Inches(0.95))
    tf2 = tb2.text_frame; tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = desc_t
    p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.color.rgb = C_TEXT

add_footer(s7, 7)

# ==============================================================================
# SLIDE 8: 文件革命 (9 大規格書)
# ==============================================================================
s8 = create_slide()
add_header(s8, "07. 文件革命", "問題：AI 寫完代碼沒人敢維護？技術文件如何救命？", "把寫文件從「事後補交差事」翻轉為「寫代碼前的思考外包」與「代碼意圖傳承」")

# 左：9 大規格書
add_box(s8, 0.8, 1.85, 4.5, 5.0, fill=C_CARD, border=C_BLUE, width=1.2)
tb = s8.shapes.add_textbox(Inches(1.0), Inches(1.95), Inches(4.1), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "📘 專案 9 大全套技術資產"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_BLUE
p.space_after = Pt(8)

docs = [
    "• 01_SRS 系統需求規格書",
    "• 02_Architecture 系統架構書",
    "• 03_API 標準書 (OpenAPI)",
    "• 04_DB Schema 資料庫字典",
    "• 05_Deployment 部署指南",
    "• 06_Operations 維運除錯手冊",
    "• 07_UserGuide 終端操作手冊",
    "• 08_CodeHandover ⚡ AI 交接文件",
    "• 09_DispersionModel 擴散模型文件"
]
for d in docs:
    p = tf.add_paragraph()
    p.text = d
    p.font.name = FONT_BODY; p.font.size = Pt(11.5)
    p.font.color.rgb = C_ORANGE if "08_" in d else C_TEXT
    p.font.bold = True if "08_" in d else False
    p.space_after = Pt(3)

p_end = tf.add_paragraph()
p_end.text = "\n※ 每個模組具備完整 Mermaid 架構圖與 ISO/IEC 25010 標準章節結構。"
p_end.font.name = FONT_BODY; p_end.font.size = Pt(10); p_end.font.color.rgb = C_MUTED

# 右：08_CodeHandover 剖析
add_box(s8, 5.6, 1.85, 6.933, 5.0, fill=C_TERM, border=C_ORANGE, width=1.2)
tb = s8.shapes.add_textbox(Inches(5.8), Inches(1.95), Inches(6.5), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "⚡ 08_CodeHandover.html — 反直覺設計記錄"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_ORANGE
p.space_after = Pt(8)

p2 = tf.add_paragraph()
p2.text = "許多人以為交接文件只是列出目錄清單，但在 08_CodeHandover 中，AI 記錄了最珍貴的「反直覺設計背後原因」：\n\n" \
          "// 在 anomalies/route.ts 中：\n" \
          "autoCreateEvents(clusters);  // ⚠️ 刻意不加 await！\n\n" \
          "• 維護者陷阱：菜鳥工程師看到沒加 await 會以為是 bug 想幫忙補上。\n" \
          "• 交接文件註明：一旦加了 await，API 響應時間會從 200ms 暴增至 3 秒！這是刻意設計的背景異步非阻塞解耦！\n\n" \
          "🎯 真正的技術傳承：\n" \
          "讓 6 個月後的自己與交接同事，知道每一行怪異代碼背後的權衡與妥協，徹底根除技術債！"
p2.font.name = FONT_BODY; p2.font.size = Pt(11.5); p2.font.color.rgb = C_MUTED

add_footer(s8, 8)

# ==============================================================================
# SLIDE 9: 血淚教訓 (四大坑)
# ==============================================================================
s9 = create_slide()
add_header(s9, "08. 血淚教訓", "與 AI 協作的四大血淚大坑與避坑指南", "如果不做嚴格架構審查，AI 會帶你掉進哪些可怕的萬丈深淵？")

traps = [
    ("❌ 大坑 1：版本斷層幻覺", "AI 訓練知識庫停留在舊版本，張口就給 Next.js 14 / React 18 廢棄語法 (如 getServerSideProps)。",
     "🛡️ 破解之道：在專案根目錄放 AGENTS.md，第一行就大字宣告 Next 16 App Router / React 19 與嚴格禁用語法清單！", C_RED),
    ("❌ 大坑 2：巨型 Prompt 崩潰", "下指令「幫我寫完整地圖元件」，AI 一次噴 2,500 行代碼後直接截斷卡死，除錯難度如登天。",
     "🛡️ 破解之道：元件切分法 (Component Chunks)。拆為 MapShell ➔ SensorLayers ➔ EventMarkers，單次對話只產出 200 行聚焦代碼！", C_ORANGE),
    ("❌ 大坑 3：一本正經胡說八道", "沒有給邊界條件，AI 寫出的大氣擴散模型出現風速為 0 噴 NaN、逆風倒流擴散的荒謬物理現象。",
     "🛡️ 破解之道：人類牢牢掌握領域物理本質，將偏微分降維公式化，並親自編寫極限邊界測試案例約束 AI！", C_YELLOW),
    ("❌ 大坑 4：無邊界的依賴膨脹", "叫 AI 寫個距離計算，AI 就偷偷 npm install turf 引入數十 MB 第三方套件，讓 bundle 暴增。",
     "🛡️ 破解之道：嚴格規範「Zero External Dependencies」方針，逼 AI 用純數學純原生語法實作演算法！", C_BLUE)
]

for i, (t_title, t_problem, t_fix, t_col) in enumerate(traps):
    y = 1.85 + i * 1.25
    add_box(s9, 0.8, y, 11.733, 1.15, fill=C_CARD, border=t_col, width=1.2)
    
    tb = s9.shapes.add_textbox(Inches(1.0), Inches(y + 0.1), Inches(4.5), Inches(0.95))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = t_title
    p.font.name = FONT_HEADING; p.font.size = Pt(13); p.font.bold = True; p.font.color.rgb = t_col
    p_prob = tf.add_paragraph()
    p_prob.text = t_problem
    p_prob.font.name = FONT_BODY; p_prob.font.size = Pt(10); p_prob.font.color.rgb = C_MUTED
    
    tb2 = s9.shapes.add_textbox(Inches(5.6), Inches(y + 0.1), Inches(6.7), Inches(0.95))
    tf2 = tb2.text_frame; tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = t_fix
    p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.bold = True; p.font.color.rgb = C_GREEN

add_footer(s9, 9)

# ==============================================================================
# SLIDE 10: 思維升級 (業餘者 vs 專家)
# ==============================================================================
s10 = create_slide()
add_header(s10, "09. 思維升級", "核心結論：把 AI 當成「外包工程團隊」來管", "業餘使用者 vs 高效工程師使用 AI 的根本思維鴻溝")

# 左：業餘者
add_box(s10, 0.8, 1.85, 5.7, 5.0, fill=C_CARD, border=C_RED, width=1.2)
tb = s10.shapes.add_textbox(Inches(1.0), Inches(1.95), Inches(5.3), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "❌ 業餘者視角：把 AI 當萬能算命師"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_RED
p.space_after = Pt(8)

amateur = [
    ("• 提問模式：", "「你覺得這個物聯網系統該怎麼做？」"),
    ("• 工作習慣：", "直接複製貼上，不看代碼邏輯，直接跑跑看。"),
    ("• 遭遇報錯：", "整段報錯無腦丟回去罵 AI，陷入無窮迴圈。"),
    ("• 心理預期：", "以為 AI 具備讀心術，應該懂所有的隱性業務規則。"),
    ("• 最終結局：", "代碼堆積成無人敢碰、毫無測試的義大利麵垃圾山！耗時數週除錯，最終只能打掉重練。")
]
for h, b in amateur:
    p = tf.add_paragraph()
    p.text = h + " " + b
    p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.color.rgb = C_MUTED
    p.space_after = Pt(5)

# 右：專家
add_box(s10, 6.833, 1.85, 5.7, 5.0, fill=C_CARD, border=C_GREEN, width=1.2)
tb = s10.shapes.add_textbox(Inches(7.0), Inches(1.95), Inches(5.3), Inches(4.7))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "🟢 專家視角：把 AI 當高產能資深實習生"
p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = C_GREEN
p.space_after = Pt(8)

expert = [
    ("• 提問模式：", "「這是 types.ts 介面契約與邊界約束，請嚴格實現此函式並覆蓋極限測試。」"),
    ("• 工作習慣：", "人類掌控架構、物理本質與約束邊界，AI 專注細節實現。"),
    ("• 遭遇報錯：", "親自定位根因，給出明確修正方向做手術刀修復。"),
    ("• 規格先行：", "先寫 SRS 與測試案例，再讓 AI 依據規格產出代碼。"),
    ("• 最終結局：", "1 個人展現 5 人研發團隊的超高質量交付力！掌握核心主導權，讓 AI 成為百倍槓桿！")
]
for h, b in expert:
    p = tf.add_paragraph()
    p.text = h + " " + b
    p.font.name = FONT_BODY; p.font.size = Pt(11); p.font.color.rgb = C_TEXT
    p.space_after = Pt(5)

add_footer(s10, 10)

# ==============================================================================
# SLIDE 11: 團隊行動 (3 大實戰套路)
# ==============================================================================
s11 = create_slide()
add_header(s11, "10. 團隊行動", "公司同仁明天上班立刻能用的 3 大實戰套路", "無需學習複雜理論，直接套用在日常業務中的高效工作流")

routines = [
    ("套路 1：逆向質詢法", "適用：PM、專案經理與企劃", "「不要問 AI 怎麼做，問 AI 哪裡會死」",
     "Prompt 範例：\n「請審閱這份需求規格，以資深架構師視角列出 5 個最可能導致專案延遲或崩潰的邊界盲點，並針對每個盲點提出防禦對策。」",
     "✔ 效益：自動完成專案風控與防呆設計！", C_BLUE),
    ("套路 2：契約先行法", "適用：前端、後端、韌體工程師", "「先寫 types.ts，再寫邏輯」",
     "Prompt 範例：\n「這是介面定義 types.ts。請嚴格依照此契約撰寫演算法函式，不得新增未定義欄位，並加上完整中文註解與極限防護。」",
     "✔ 效益：代碼風格與型別安全達到 100% 一致！", C_PURPLE),
    ("套路 3：統計提煉法", "適用：數據分析師、營運維運人員", "「給予數據樣本，自動生成洞察」",
     "Prompt 範例：\n「這是前 20 筆感測資料。請寫出時間窗統計腳本，並為這組分佈撰寫 3 點具備法律公信力的調查結論與風向關聯分析。」",
     "✔ 效益：專業報告撰寫由數天縮短至數小時！", C_GREEN)
]

for i, (title, target, rule, prompt_ex, benefit, col) in enumerate(routines):
    x = 0.8 + i * 4.0
    add_box(s11, x, 1.85, 3.733, 5.0, fill=C_CARD, border=col, width=1.2)
    
    tb = s11.shapes.add_textbox(Inches(x + 0.15), Inches(1.95), Inches(3.433), Inches(4.7))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title
    p.font.name = FONT_HEADING; p.font.size = Pt(14); p.font.bold = True; p.font.color.rgb = col
    
    p_t = tf.add_paragraph()
    p_t.text = target
    p_t.font.name = FONT_BODY; p_t.font.size = Pt(10.5); p_t.font.color.rgb = C_MUTED
    p_t.space_after = Pt(4)

    p_r = tf.add_paragraph()
    p_r.text = rule
    p_r.font.name = FONT_HEADING; p_r.font.size = Pt(12); p_r.font.bold = True; p_r.font.color.rgb = C_TEXT
    p_r.space_after = Pt(6)

    p_ex = tf.add_paragraph()
    p_ex.text = prompt_ex
    p_ex.font.name = FONT_BODY; p_ex.font.size = Pt(10); p_ex.font.color.rgb = C_MUTED
    p_ex.space_after = Pt(8)

    p_b = tf.add_paragraph()
    p_b.text = benefit
    p_b.font.name = FONT_BODY; p_b.font.size = Pt(11); p_b.font.bold = True; p_b.font.color.rgb = C_GREEN

add_footer(s11, 11)

# ==============================================================================
# SLIDE 12: 結語與啟發
# ==============================================================================
s12 = create_slide()

# 標籤
badge = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.4), Inches(2.8), Inches(0.32))
badge.fill.solid(); badge.fill.fore_color.rgb = C_CARD
badge.line.color.rgb = C_ORANGE; badge.line.width = Pt(1)
badge.adjustments[0] = 0.5
tf = badge.text_frame
p = tf.paragraphs[0]
p.text = "🎯 結語與啟發"
p.font.name = FONT_HEADING; p.font.size = Pt(10.5); p.font.bold = True; p.font.color.rgb = C_ORANGE
p.alignment = PP_ALIGN.CENTER

# 主標語
tb = s12.shapes.add_textbox(Inches(0.8), Inches(0.85), Inches(11.733), Inches(0.8))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "AI 不會縮短你的思考，它釋放你的時間去更深度地思考！"
p.font.name = FONT_HEADING; p.font.size = Pt(24); p.font.bold = True; p.font.color.rgb = C_TEXT

# 三大啟發卡片 (橫向 3 欄)
insights = [
    ("1. 問題定義能力", "真正拉開人與人差距的，不再是寫了多少行語法，而是「你能定義多麼清晰的問題與邊界」。", C_BLUE),
    ("2. 工程價值回歸", "當打字與重複性編碼被 AI 接管，工程師的核心價值回歸到「物理本質、系統架構審美與業務洞察」。", C_PURPLE),
    ("3. 人機協同威力", "在 TC IoT Center 專案中，我們證明了一個人透過深度人機協同，能交付過去需要整個團隊才能完成的工業級系統！", C_GREEN)
]
for i, (t, d, col) in enumerate(insights):
    x = 0.8 + i * 4.0
    add_box(s12, x, 1.85, 3.733, 3.4, fill=C_CARD, border=col, width=1.2)
    tb = s12.shapes.add_textbox(Inches(x + 0.15), Inches(2.0), Inches(3.433), Inches(3.0))
    tf = tb.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = t
    p.font.name = FONT_HEADING; p.font.size = Pt(15); p.font.bold = True; p.font.color.rgb = col
    p.space_after = Pt(8)
    p2 = tf.add_paragraph()
    p2.text = d
    p2.font.name = FONT_BODY; p2.font.size = Pt(12); p2.font.color.rgb = C_TEXT

# 底部 Q&A 區塊
add_box(s12, 0.8, 5.5, 11.733, 1.35, fill=C_TERM, border=C_ORANGE, width=1.5)
tb = s12.shapes.add_textbox(Inches(1.0), Inches(5.6), Inches(11.333), Inches(1.15))
tf = tb.text_frame; tf.word_wrap = True
p = tf.paragraphs[0]
p.text = "💬 謝謝大家！歡迎交流討論 (Q&A)"
p.font.name = FONT_HEADING; p.font.size = Pt(20); p.font.bold = True; p.font.color.rgb = C_ORANGE
p.alignment = PP_ALIGN.CENTER

add_footer(s12, 12)

# ==============================================================================
# 儲存投影片（支援防鎖定備份）
# ==============================================================================
try:
    prs.save(TARGET_FILE)
    print(f"✅ 成功轉換並輸出：{TARGET_FILE}")
except PermissionError:
    prs.save(BACKUP_FILE)
    print(f"⚠️ 目標檔案正被開啟鎖定中，已輸出至備份檔案：\n{BACKUP_FILE}\n請關閉 PowerPoint 後即可覆蓋！")
