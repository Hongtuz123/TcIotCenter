# -*- coding: utf-8 -*-
"""
《一個人 + AI，20 小時做出一套監測系統？》
微感監測中心 Vibe Coding 實戰拆解 — PM 導向 15 分鐘簡報產生器
- 16:9 寬螢幕，深色主題沿用 generate_pptx.py 色票
- 每頁附講者備忘稿（Speaker Notes）
- 截圖來源：output/pm_deck_shots/（缺圖時顯示灰色佔位框）
"""

import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "output", "pm_deck_shots")
FIGS = os.path.join(ROOT, "documents", "figures")
OUT = os.path.join(ROOT, "output", "TC_IoT_Center_VibeCoding_PM.pptx")

# 色票（與既有簡報一致）
C_BG = RGBColor(11, 15, 25)
C_CARD = RGBColor(22, 30, 46)
C_TERM = RGBColor(15, 23, 42)
C_BORDER = RGBColor(40, 53, 76)
C_ORANGE = RGBColor(249, 115, 22)
C_BLUE = RGBColor(56, 189, 248)
C_GREEN = RGBColor(74, 222, 128)
C_RED = RGBColor(248, 113, 113)
C_PURPLE = RGBColor(168, 85, 247)
C_YELLOW = RGBColor(250, 204, 21)
C_TEXT = RGBColor(248, 250, 252)
C_MUTED = RGBColor(148, 163, 184)
FONT = "Microsoft JhengHei"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
TOTAL = 15


# ───────────────────────── 共用繪圖工具 ─────────────────────────
def new_slide(notes=""):
    s = prs.slides.add_slide(BLANK)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = C_BG
    bg.line.fill.background()
    if notes:
        s.notes_slide.notes_text_frame.text = notes
    return s


def text(slide, x, y, w, h, lines, size=14, color=C_TEXT, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=4):
    """lines 可為字串或 list；list 元素可為 (文字, 色, 字級, 粗體) tuple"""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.05)
    if isinstance(lines, str):
        lines = [lines]
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        t, c, sz, b = ln if isinstance(ln, tuple) else (ln, color, size, bold)
        p.text = t
        p.font.name = FONT
        p.font.size = Pt(sz)
        p.font.color.rgb = c
        p.font.bold = b
        p.alignment = align
        p.space_after = Pt(spacing)
    return tb


def box(slide, x, y, w, h, fill=C_CARD, border=C_BORDER, width=1.0, shape=MSO_SHAPE.ROUNDED_RECTANGLE):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    if border is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = border
        s.line.width = Pt(width)
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = 0.08
    return s


def header(slide, no, tag, title, sub=""):
    b = box(slide, 0.7, 0.35, 2.6, 0.34, fill=C_CARD, border=C_ORANGE)
    b.adjustments[0] = 0.5
    text(slide, 0.7, 0.36, 2.6, 0.32, tag, 11, C_ORANGE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, 0)
    text(slide, 0.7, 0.75, 11.9, 0.7, title, 26, C_TEXT, True)
    if sub:
        text(slide, 0.7, 1.35, 11.9, 0.4, sub, 13, C_BLUE)
    text(slide, 11.6, 7.0, 1.2, 0.3, f"{no} / {TOTAL}", 10, C_MUTED, align=PP_ALIGN.RIGHT)


def image(slide, path, x, y, w=None, h=None):
    """放圖；缺檔時畫佔位框，避免整份簡報產不出來"""
    if os.path.exists(path):
        kw = {}
        if w:
            kw["width"] = Inches(w)
        if h:
            kw["height"] = Inches(h)
        pic = slide.shapes.add_picture(path, Inches(x), Inches(y), **kw)
        pic.line.color.rgb = C_BORDER
        pic.line.width = Pt(1)
        return pic
    box(slide, x, y, w or 6, h or 3.4, fill=C_TERM, border=C_BORDER)
    text(slide, x, y, w or 6, h or 3.4, f"[缺圖] {os.path.basename(path)}", 14, C_MUTED, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)


def callouts(slide, x, y, w, items, gap=1.12):
    """右側說明卡：items = [(標題, 說明, 色)]"""
    for i, (t, d, c) in enumerate(items):
        top = y + i * gap
        box(slide, x, top, w, gap - 0.14, fill=C_CARD, border=c)
        text(slide, x + 0.15, top + 0.08, w - 0.3, gap - 0.25, [(t, c, 14, True), (d, C_MUTED, 11.5, False)], spacing=3)


# ───────────────────────── 1. 封面 ─────────────────────────
s = new_slide(
    "開場（20 秒）：\n"
    "今天不講程式碼，講三件事：這系統做了什麼、我怎麼跟 AI 合作、以及下次各位帶案子時可以怎麼用。\n"
    "先預告：中間會有不少我自己踩坑的畫面，請大家笑的時候小聲一點。"
)
box(s, 0.7, 0.7, 11.93, 6.1, fill=C_CARD, border=C_ORANGE, width=1.5)
text(s, 1.2, 1.1, 10, 0.4, "⚡ Vibe Coding 實戰拆解 · 給 PM 的版本", 14, C_ORANGE, True)
text(s, 1.2, 1.7, 11, 1.8, [("一個人 + AI，20 小時", C_TEXT, 44, True), ("做出一套空品監測系統？", C_TEXT, 44, True)], spacing=2)
text(s, 1.2, 3.75, 11, 0.5, "微感監測中心（TC IoT Center）功能介紹 × 協作心法 × 踩坑實錄", 18, C_BLUE)
box(s, 1.2, 4.6, 10.9, 1.6, fill=C_TERM, border=C_BORDER)
text(
    s, 1.45, 4.72, 10.5, 1.4,
    [
        ("今天 15 分鐘會講：", C_GREEN, 14, True),
        ("① 系統做了什麼　② 怎麼跟 AI 合作　③ PM 下次可以怎麼用　④ 我踩過的坑與還沒做完的事", C_MUTED, 13, False),
    ],
)
text(s, 1.2, 6.25, 6, 0.4, "講者：Tim　｜　2026/10", 12, C_MUTED)

# ───────────────────────── 2. 一句話說清楚 ─────────────────────────
s = new_slide(
    "（1 分鐘）\n"
    "一句話：把臺中產業園區周邊的空品微感器資料，自動變成『有沒有異常、可能從哪來、出一份報告』。\n"
    "強調：以前這是『人盯資料 + Excel 畫圖 + Word 貼圖』的工作，現在是系統自動跑。"
)
header(s, 2, "01 · 系統是什麼", "一句話：讓上千支感測器自己「舉手報告」", "臺中 20 個產業園區、1,401 支空品微感器，每 5 分鐘一筆資料")
steps = [
    ("📡 抓資料", "每 5 分鐘自動從民生公共物聯網抓 PM2.5 / TVOC", C_BLUE),
    ("🚨 判異常", "連續超標＋附近多站一起超標，才算數（防誤報）", C_RED),
    ("🌬️ 找來源", "搭配氣象站風向，模擬污染往哪飄", C_PURPLE),
    ("📄 出報告", "圖表、Word、PDF 自動產出", C_GREEN),
]
for i, (t, d, c) in enumerate(steps):
    x = 0.7 + i * 3.08
    box(s, x, 2.1, 2.8, 2.5, fill=C_CARD, border=c, width=1.5)
    text(s, x + 0.15, 2.3, 2.5, 0.6, t, 22, c, True, PP_ALIGN.CENTER)
    text(s, x + 0.2, 3.05, 2.4, 1.4, d, 13, C_TEXT, align=PP_ALIGN.CENTER)
    if i < 3:
        text(s, x + 2.78, 3.0, 0.32, 0.6, "➜", 22, C_MUTED, True, PP_ALIGN.CENTER)
box(s, 0.7, 4.95, 5.85, 1.8, fill=C_TERM, border=C_RED)
text(s, 0.95, 5.05, 5.4, 1.6, [("以前", C_RED, 15, True), ("人工盯資料 → Excel 畫圖 → Word 貼圖排版 → 寄出", C_MUTED, 13, False), ("等報告出來，事情已經過了好幾天", C_MUTED, 13, False)])
box(s, 6.78, 4.95, 5.85, 1.8, fill=C_TERM, border=C_GREEN)
text(s, 7.03, 5.05, 5.4, 1.6, [("現在", C_GREEN, 15, True), ("系統自動判斷、自動開事件、地圖上直接看", C_MUTED, 13, False), ("報告用腳本一鍵產出，人只負責判讀與決策", C_MUTED, 13, False)])

# ───────────────────────── 3. 專案數字 ─────────────────────────
s = new_slide(
    "（40 秒）\n"
    "1 個人、約一週工作天、實際動手大約 20 小時，把核心系統做出來並上線。\n"
    "249 次 commit 是到今天為止的累計，包含後續的報告與資料處理。\n"
    "右下的傳統估算是我的體感推估，不是正式報價，重點是讓大家感受量級差異。\n"
    "自嘲：249 次 commit 裡，有不少是在修 AI 上一次自信滿滿改壞的地方。"
)
header(s, 3, "01 · 專案數字", "數字會說話（雖然有些話很心虛）")
nums = [("1", "人", "我 + AI，沒有前端、後端、美術", C_ORANGE), ("~20", "小時", "約一週工作天，邊做邊調", C_BLUE), ("249", "次 commit", "每一小步都存檔，可隨時回滾", C_GREEN), ("9", "份文件", "需求、架構、API、DB…都由 AI 起草", C_PURPLE)]
for i, (n, u, d, c) in enumerate(nums):
    x = 0.7 + i * 3.08
    box(s, x, 1.75, 2.8, 2.6, fill=C_CARD, border=c, width=1.5)
    text(s, x, 1.9, 2.8, 1.1, n, 54, c, True, PP_ALIGN.CENTER)
    text(s, x, 2.95, 2.8, 0.45, u, 18, C_TEXT, True, PP_ALIGN.CENTER)
    text(s, x + 0.2, 3.45, 2.4, 0.8, d, 12, C_MUTED, align=PP_ALIGN.CENTER)
box(s, 0.7, 4.7, 7.2, 2.1, fill=C_TERM, border=C_BORDER)
text(
    s, 0.95, 4.8, 6.8, 1.9,
    [
        ("用到的技術（聽過就好）", C_BLUE, 14, True),
        ("網站：Next.js + React　地圖：Mapbox 3D", C_MUTED, 12.5, False),
        ("資料庫：Supabase（雲端 PostgreSQL）　部署：Vercel", C_MUTED, 12.5, False),
        ("資料處理 / 報告：Python 腳本", C_MUTED, 12.5, False),
    ],
)
box(s, 8.1, 4.7, 4.53, 2.1, fill=C_TERM, border=C_YELLOW)
text(
    s, 8.35, 4.8, 4.1, 1.9,
    [
        ("傳統做法（體感推估）", C_YELLOW, 14, True),
        ("PM + 前端 + 後端 + GIS", C_MUTED, 12.5, False),
        ("至少 1～2 個月起跳", C_MUTED, 12.5, False),
        ("※ 非正式估價，僅供感受量級", C_MUTED, 10.5, False),
    ],
)

# ───────────────────────── 4. 系統全景圖 ─────────────────────────
s = new_slide(
    "（1 分鐘）\n"
    "用四個盒子講完整個系統：資料從哪來、存在哪、在哪看、產出什麼。\n"
    "下面那排是『傳統專案裡這塊是誰負責』—— 這次這些角色的工作都是 AI 做的，但『決定要做什麼、驗收對不對』還是人。"
)
header(s, 4, "01 · 系統全景", "四個盒子看懂整個系統", "PM 版架構圖：不講技術細節，只講資料怎麼流")
blocks = [
    ("資料來源", ["民生公共物聯網 API", "（微感器 5 分鐘資料）", "氣象署 / 環保局氣象站", "（風向風速）"], "後端工程師", C_BLUE),
    ("資料庫", ["Supabase 雲端資料庫", "排程程式定時寫入", "事件、門檻設定"], "後端 / DBA", C_PURPLE),
    ("網站（儀表板）", ["即時 3D 地圖", "事件管理 / 擴散模擬", "20 園區歷史分析"], "前端工程師", C_ORANGE),
    ("產出", ["Word / PDF 調查報告", "Excel 統計資料", "9 份系統文件"], "PM / 文管", C_GREEN),
]
for i, (t, items, role, c) in enumerate(blocks):
    x = 0.7 + i * 3.08
    box(s, x, 2.0, 2.8, 3.3, fill=C_CARD, border=c, width=1.5)
    text(s, x, 2.15, 2.8, 0.5, t, 18, c, True, PP_ALIGN.CENTER)
    text(s, x + 0.15, 2.8, 2.5, 2.4, items, 12.5, C_TEXT, align=PP_ALIGN.CENTER)
    if i < 3:
        text(s, x + 2.78, 3.3, 0.32, 0.6, "➜", 22, C_MUTED, True, PP_ALIGN.CENTER)
    box(s, x, 5.5, 2.8, 0.6, fill=C_TERM, border=C_BORDER)
    text(s, x, 5.5, 2.8, 0.6, f"傳統由：{role}", 12, C_MUTED, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
text(s, 0.7, 6.35, 11.9, 0.5, "👉 這次四塊全部由 AI 實作；人負責：定需求、給資料、驗收數字、決定上線", 15, C_YELLOW, True, PP_ALIGN.CENTER)

# ───────────────────────── 5～8. 功能導覽（截圖） ─────────────────────────
feature_pages = [
    (
        5, "02 · 功能導覽 ①", "即時監控地圖：一眼看出哪裡在冒煙", os.path.join(SHOTS, "main_loaded.png"),
        [
            ("🗺️ 3D 地圖 + 園區邊界", "紫色區塊是產業園區，點位是微感器", C_BLUE),
            ("🎨 空品五級色階", "依環境部最新 PM2.5 標準上色", C_GREEN),
            ("⏪ 歷史回播", "拉時間軸回看 24 小時變化", C_ORANGE),
            ("🔍 篩選", "可依園區、設備、指標、時間篩選", C_PURPLE),
        ],
        "（1 分鐘）主畫面。左邊篩選、中間地圖、右邊事件。\n可以提一下：版面是我口頭描述『左篩選、中地圖、右事件』，AI 直接做出來，後面再一點一點調。",
    ),
    (
        6, "02 · 功能導覽 ②", "異常偵測：不是超標就叫，要「一群」超標才叫", os.path.join(SHOTS, "settings.png"),
        [
            ("⏱️ 連續超標", "同一站連續 N 筆（每筆 5 分鐘）都超標", C_RED),
            ("📍 空間聚集", "半徑 X 公里內至少 Y 站同時超標", C_ORANGE),
            ("🎛️ 門檻可調", "業務單位自己調，不用改程式", C_BLUE),
            ("🧾 自動開事件", "符合規則就自動建立事件、可追蹤", C_GREEN),
        ],
        "（1 分鐘）這是整個系統最有業務價值的設計。\n單一感測器很容易被路邊機車、烤肉干擾，如果一超標就叫，一天會被叫到沒人理。\n所以規則是『連續超標 + 附近多站一起超標』才算事件，這個規則是我跟 AI 來回討論出來的，不是 AI 自己想到的。",
    ),
    (
        7, "02 · 功能導覽 ③", "擴散模擬：污染可能往哪飄？", os.path.join(SHOTS, "dispersion.png"),
        [
            ("🌬️ 綁定氣象站", "自動找最近的法定氣象站取風向風速", C_BLUE),
            ("💨 煙團動畫", "用大氣擴散公式模擬污染飄移範圍", C_PURPLE),
            ("🎯 輔助溯源", "回推可能的上風處污染來源", C_GREEN),
            ("⚠️ 定位", "輔助判讀工具，不是法定模式", C_YELLOW),
        ],
        "（1 分鐘）點事件上的『擴散』按鈕，就會依風場跑一段煙團動畫。\n要誠實講：這是簡化的物理模型，定位是『輔助判讀』，不是法定擴散模式。\n踩坑預告：AI 第一版的公式會出現『逆風擴散』這種違反物理的結果，是我看動畫覺得怪才抓到的。",
    ),
    (
        8, "02 · 功能導覽 ④", "歷史分析 + 報告：從看圖到出公文", os.path.join(SHOTS, "analytics.png"),
        [
            ("🏭 20 園區排名", "哪個園區超標最多、最嚴重", C_ORANGE),
            ("🗓️ 7×24 熱力矩陣", "看出「半夜偷排」這種時段規律", C_RED),
            ("📈 月趨勢", "跨年度比較、自訂日期區間", C_BLUE),
            ("📄 一鍵出報告", "Python 腳本產 Word / PDF 調查報告", C_GREEN),
        ],
        "（1 分鐘）歷史分析頁，把一年多的資料預先算好，所以打開很快。\n大甲異味調查就是用這套產出的：7×24 熱力圖一看就知道問題集中在深夜。\n報告的圖、表、文字結構都是腳本產生，改資料重跑就好，不用再手動貼圖排版。",
    ),
]
for no, tag, title, img, items, notes in feature_pages:
    s = new_slide(notes)
    header(s, no, tag, title)
    image(s, img, 0.7, 1.55, w=8.4)
    callouts(s, 9.3, 1.55, 3.33, items, gap=1.2)

# ───────────────────────── 9. 流程對照 ─────────────────────────
s = new_slide(
    "（1 分鐘）\n"
    "傳統流程是瀑布式的：每一關交給不同的人，交接成本很高。\n"
    "Vibe Coding 是『說 → 看 → 改』的小循環，一天可以跑幾十圈。\n"
    "重點訊息：PM 的角色沒有消失，反而更重要 —— 需求講不清楚，AI 會很有效率地做出錯的東西。"
)
header(s, 9, "03 · 怎麼做出來的", "開發流程：從「接力賽」變成「對話」")
box(s, 0.7, 1.6, 5.85, 5.2, fill=C_CARD, border=C_MUTED)
text(s, 0.95, 1.7, 5.4, 0.5, "🏢 傳統流程（接力賽）", 17, C_MUTED, True)
trad = ["PM 訪談需求、寫需求書", "SA / SD 出規格", "前端、後端分頭開發", "整合測試、修 bug", "補文件、交接"]
for i, t in enumerate(trad):
    y = 2.35 + i * 0.85
    box(s, 1.0, y, 5.25, 0.65, fill=C_TERM, border=C_BORDER)
    text(s, 1.15, y, 5.0, 0.65, f"{i + 1}. {t}", 13.5, C_TEXT, anchor=MSO_ANCHOR.MIDDLE)
box(s, 6.78, 1.6, 5.85, 5.2, fill=C_CARD, border=C_ORANGE, width=1.5)
text(s, 7.03, 1.7, 5.4, 0.5, "⚡ Vibe Coding（對話循環）", 17, C_ORANGE, True)
loop = [("💬 說", "用白話描述要什麼，附範例或截圖", C_BLUE), ("👀 看", "AI 幾分鐘內做出來，直接在瀏覽器看", C_PURPLE), ("✅ 驗", "人檢查：數字對不對？符不符合業務？", C_YELLOW), ("💾 存", "沒問題就 commit 存檔，有問題就回滾", C_GREEN)]
for i, (t, d, c) in enumerate(loop):
    y = 2.35 + i * 0.85
    box(s, 7.08, y, 5.25, 0.65, fill=C_TERM, border=c)
    text(s, 7.23, y, 5.0, 0.65, [(f"{t}　", c, 14, True)], anchor=MSO_ANCHOR.MIDDLE)
    text(s, 8.0, y, 4.3, 0.65, d, 12.5, C_TEXT, anchor=MSO_ANCHOR.MIDDLE)
text(s, 7.03, 5.85, 5.4, 0.9, "🔁 一天可以跑幾十圈；但每一圈的「驗」都要人來做", 13, C_ORANGE, True)

# ───────────────────────── 10. 把 AI 當專家實習生 ─────────────────────────
s = new_slide(
    "（1 分鐘）\n"
    "最好用的心態：把 AI 當成一個『技術很強、手很快，但第一天來上班的實習生』。\n"
    "他什麼技術都會，但不懂我們的業務、不會主動問問題，而且做錯的時候語氣跟做對的時候一模一樣自信。\n"
    "所以 PM 要做的事，跟帶一個新人很像：交代清楚、給範例、驗收、把規矩寫下來。"
)
header(s, 10, "03 · 核心心法", "把 AI 當成「專家實習生」", "技術很強、手很快，但第一天來上班")
box(s, 0.7, 1.95, 5.85, 3.3, fill=C_CARD, border=C_GREEN, width=1.5)
text(s, 0.95, 2.05, 5.4, 3.1, [("👍 他很強的地方", C_GREEN, 17, True), ("• 前端、後端、資料庫、GIS 都會", C_TEXT, 14, False), ("• 幾分鐘就生出一版，不會累、不會抱怨", C_TEXT, 14, False), ("• 文件、註解、報告也願意寫", C_TEXT, 14, False), ("• 可以 24 小時隨叫隨到", C_TEXT, 14, False)], spacing=6)
box(s, 6.78, 1.95, 5.85, 3.3, fill=C_CARD, border=C_RED, width=1.5)
text(s, 7.03, 2.05, 5.4, 3.1, [("👎 他會出包的地方", C_RED, 17, True), ("• 不懂你的業務（什麼叫「事件」？）", C_TEXT, 14, False), ("• 不會主動問，會自己腦補", C_TEXT, 14, False), ("• 做錯時跟做對時一樣自信", C_TEXT, 14, False), ("• 改 A 的時候順手把 B 弄壞", C_TEXT, 14, False)], spacing=6)
box(s, 0.7, 5.5, 11.93, 1.3, fill=C_TERM, border=C_ORANGE)
text(s, 0.95, 5.58, 11.5, 1.15, [("所以 PM 的工作 = 帶新人", C_ORANGE, 16, True), ("交代清楚（目標 + 範例）　→　小步驗收（一次一件事）　→　把規矩寫下來（AGENTS.md）　→　數字自己核對", C_TEXT, 14, False)])

# ───────────────────────── 11. 給 PM 的 5 個實戰建議 ─────────────────────────
s = new_slide(
    "（1 分 30 秒）\n"
    "五個建議都是我踩坑換來的：\n"
    "1. 先讓 AI 寫規格：先說『不要寫程式，先寫需求規格給我看』，對齊了再動手，省下大量重工。\n"
    "2. 驗收標準數字化：『好看一點』AI 聽不懂；『PM2.5 門檻用環境部 12.4/30.4/50.4…』它就做得對。\n"
    "3. 一次一件事：一次丟十個需求，它會做完七個、改壞三個，而且不會告訴你。\n"
    "4. AGENTS.md：就是給 AI 看的『專案守則』，部署方式、命名規則、禁止事項都寫在裡面。這份文件 PM 完全可以寫。\n"
    "5. 數字要人核：我在報告階段做過一次數字稽核，一次抓到 5 個錯誤。"
)
header(s, 11, "03 · 給 PM 的建議", "帶 AI 實習生的 5 個實戰建議")
tips = [
    ("1", "先要規格，再要程式", "「先不要寫程式，寫需求規格給我確認」對齊了再動手", C_BLUE),
    ("2", "驗收標準要數字化", "❌「顏色好看一點」\n✅「用環境部 PM2.5 五級：12.4 / 30.4 / 50.4…」", C_GREEN),
    ("3", "一次只交代一件事", "做完 → 看過 → commit 存檔，再做下一件；壞了隨時回滾", C_YELLOW),
    ("4", "把規矩寫成 AGENTS.md", "部署方式、用語、禁止事項寫成「新人守則」\n👉 這份 PM 就能寫", C_ORANGE),
    ("5", "數字一定要人核", "AI 不會說「我不確定」；關鍵數字抽樣比對原始資料", C_RED),
]
for i, (n, t, d, c) in enumerate(tips):
    y = 1.6 + i * 1.05
    box(s, 0.7, y, 11.93, 0.9, fill=C_CARD, border=c)
    o = box(s, 0.9, y + 0.15, 0.6, 0.6, fill=c, border=None, shape=MSO_SHAPE.OVAL)
    text(s, 0.9, y + 0.15, 0.6, 0.6, n, 18, C_BG, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, 0)
    text(s, 1.7, y, 3.6, 0.9, t, 16, c, True, anchor=MSO_ANCHOR.MIDDLE)
    text(s, 5.4, y, 7.1, 0.9, d, 12.5, C_TEXT, anchor=MSO_ANCHOR.MIDDLE, spacing=0)

# ───────────────────────── 12. 對話範例 ─────────────────────────
s = new_slide(
    "（1 分 30 秒）\n"
    "這頁是依實際開發過程整理的對話範例（非逐字稿）。\n"
    "左邊是我一開始的講法，AI 會做，但做出來的東西不能用；右邊是學乖之後的講法。\n"
    "共通點：右邊都有『目標 + 具體數字或範例 + 驗收方式』，就像交代實習生工作一樣。"
)
header(s, 12, "03 · 對話範例", "同一個需求，兩種交代方式", "依實際開發過程整理（非逐字稿）")
text(s, 2.4, 1.75, 4.6, 0.4, "❌ 菜鳥 PM 的講法", 15, C_RED, True, PP_ALIGN.CENTER)
text(s, 7.4, 1.75, 5.2, 0.4, "✅ 帶過實習生的講法", 15, C_GREEN, True, PP_ALIGN.CENTER)
pairs = [
    ("🗺️ 地圖", "「幫我做一個顯示感測器的地圖」", "「用 Mapbox 顯示 iotinformation.csv 的測站，依 PM2.5 套環境部五級色，產業園區邊界用這份 shp 畫紫色虛線。」"),
    ("🚨 告警", "「PM2.5 太高就通知我」", "「同一站連續 2 筆 >50，且 1 公里內至少 2 站同時超標才開事件；門檻要能在畫面上調。」"),
    ("📊 資料", "「幫我分析這些資料」", "「先讀前 10 筆給我看欄位意義，確認後再算各園區每日均值；pm2_5 > 500 視為故障值剔除。」"),
    ("📄 報告", "「幫我寫一份調查報告」", "「依附件公文格式產 Word：摘要、方法、月/星期/時段三層分析、結論；圖表用原始資料重畫並附數字。」"),
]
for i, (k, bad, good) in enumerate(pairs):
    y = 2.2 + i * 1.17
    box(s, 0.7, y, 1.55, 1.02, fill=C_TERM, border=C_BORDER)
    text(s, 0.7, y, 1.55, 1.02, k, 14, C_TEXT, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, 0)
    box(s, 2.4, y, 4.8, 1.02, fill=C_CARD, border=C_RED)
    text(s, 2.55, y, 4.5, 1.02, bad, 12.5, C_MUTED, anchor=MSO_ANCHOR.MIDDLE, spacing=0)
    box(s, 7.35, y, 5.28, 1.02, fill=C_CARD, border=C_GREEN)
    text(s, 7.5, y, 5.0, 1.02, good, 11.5, C_TEXT, anchor=MSO_ANCHOR.MIDDLE, spacing=0)

# ───────────────────────── 13. 踩坑實錄 ─────────────────────────
s = new_slide(
    "（1 分 30 秒）自嘲時間：\n"
    "1. 上線第一天：部署到 Vercel 連續崩潰，同一天 commit 了 4 次『修正 Vercel 崩潰』。\n"
    "2. 數字稽核：報告做完才回頭稽核，一次抓到 5 個錯（排名順序、溢位值、評分係數…），如果直接交出去就糗了。\n"
    "3. 標準改版：PM2.5 的分級門檻後來全面改成環境部最新標準，整個系統翻修一輪。\n"
    "4. 地圖圖例：調了好幾輪，AI 的 commit 訊息一次比一次浮誇（「完美精修」「100% 保留」「無任何殘影」），但我看還是歪的。\n"
    "5. 文件脫節：AI 寫的交接文件說檔案在 hooks 資料夾，實際在 components/Map，文件跟程式各說各話。\n"
    "6. 實習生不會打掃：排程 log 默默長到 47 MB，一次性腳本累積到 43 支。"
)
header(s, 13, "04 · 踩坑實錄", "我與 AI 實習生的爆笑（崩潰）日常", "以下皆為真實事件，有 commit 紀錄為證")
traps = [
    ("🔥 上線第一天就連修 4 次", "部署到 Vercel 一直崩潰，同一天 4 個 commit 都叫「修正 Vercel 崩潰」", C_RED),
    ("🔢 數字稽核一次抓到 5 個錯", "排名順序、溢位值、評分係數…差點就這樣交出去", C_ORANGE),
    ("📏 標準改版，全系統翻修", "PM2.5 分級中途改用環境部最新門檻，所有圖表跟著重來", C_YELLOW),
    ("✨ 自信滿滿的 commit 訊息", "圖例改好幾輪：「完美精修」「100% 保留」「無任何殘影」…但還是歪的", C_PURPLE),
    ("📚 文件跟程式各說各話", "交接文件寫檔案在 hooks/，實際在 components/Map/", C_BLUE),
    ("🧹 實習生不會自己打掃", "排程 log 長到 47 MB、一次性腳本累積 43 支", C_GREEN),
]
for i, (t, d, c) in enumerate(traps):
    col, row = i % 3, i // 3
    x, y = 0.7 + col * 4.02, 1.95 + row * 2.2
    box(s, x, y, 3.85, 2.0, fill=C_CARD, border=c, width=1.5)
    text(s, x + 0.18, y + 0.15, 3.5, 1.75, [(t, c, 15, True), (d, C_MUTED, 12.5, False)], spacing=8)
text(s, 0.7, 6.45, 11.93, 0.45, "💡 教訓：AI 不會說「我不確定」—— 驗收清單一定要人來寫", 16, C_ORANGE, True, PP_ALIGN.CENTER)

# ───────────────────────── 14. 未來改善建議 ─────────────────────────
s = new_slide(
    "（1 分鐘）白話版說明：\n"
    "1. 權限分級：現在所有人共用同一組密碼、權限都一樣；改成管理者/一般使用者/唯讀，才能開給客戶或其他單位。\n"
    "2. 地圖效能：一千多個點位逐一畫在畫面上，舊電腦播放歷史時會卡；改用顯示卡繪圖的方式就會順。\n"
    "3. 主動推播：現在要有人開著儀表板才看得到事件；改成自動發 LINE / Email 通知。\n"
    "4. 自動化測試：目前沒有自動測試，AI 改 A 壞 B 只能靠人眼發現；補上測試就能自動攔截。\n"
    "5. 維運整理：log 自動清理、43 支一次性腳本整理成固定流程，交接給別人才接得起來。\n"
    "6. 資料品質：微感器常離線（畫面上完整度約八成），先讓使用者知道資料可不可信，再看結論。\n"
    "（優先順序與規模是我的初步判斷，可再討論）"
)
header(s, 14, "04 · 未來改善", "還沒做完的事（白話版）", "優先順序與規模為初步判斷，歡迎討論")
cols = [("類別", 1.5), ("現在的狀況", 3.6), ("建議改成", 3.4), ("對使用者的好處", 3.43)]
x0, y0 = 0.7, 1.85
x = x0
for name, w in cols:
    box(s, x, y0, w - 0.05, 0.5, fill=C_TERM, border=C_ORANGE, shape=MSO_SHAPE.RECTANGLE)
    text(s, x, y0, w - 0.05, 0.5, name, 13, C_ORANGE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, 0)
    x += w
rows = [
    ("🔐 權限", "大家共用一組密碼，權限都一樣", "管理者 / 一般 / 唯讀 分級", "能開放給客戶或其他單位"),
    ("⚡ 效能", "一千多個點位，舊電腦播放會卡", "改用顯示卡繪圖（WebGL 圖層）", "歷史回播順暢不卡頓"),
    ("📲 推播", "要有人開著畫面才看得到事件", "事件自動發 LINE / Email", "從「被動看」變「主動通知」"),
    ("🧪 測試", "沒有自動測試，改壞只能靠人眼", "補自動化測試、數字比對", "降低 AI 改 A 壞 B 的風險"),
    ("🧹 維運", "log 47 MB、43 支一次性腳本", "log 自動清理、腳本整理成流程", "交接給別人接得起來"),
    ("📶 資料品質", "資料完整度約八成，常有離線站", "資料完整度儀表板（已有雛形）", "先知道資料可不可信"),
]
for r, row in enumerate(rows):
    y = y0 + 0.55 + r * 0.72
    x = x0
    for c, (val, (_, w)) in enumerate(zip(row, cols)):
        box(s, x, y, w - 0.05, 0.66, fill=C_CARD, border=C_BORDER, shape=MSO_SHAPE.RECTANGLE)
        text(s, x + 0.08, y, w - 0.2, 0.66, val, 12.5 if c else 13, C_TEXT if c else C_BLUE, c == 0, PP_ALIGN.LEFT if c else PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, 0)
        x += w

# ───────────────────────── 15. 團隊導入 + Q&A ─────────────────────────
s = new_slide(
    "（1 分鐘）收尾：\n"
    "建議三步走：先挑一個風險低的內部小工具試點；做完把 AGENTS.md、驗收清單、prompt 範本整理成團隊共用；再調整分工 —— PM 寫規格與驗收、工程師負責架構與審查、實作交給 AI。\n"
    "最後一句：AI 讓寫程式變便宜了，但『知道要做什麼、做對了沒有』變得更值錢 —— 而這正是 PM 的專長。\n"
    "開放 Q&A，有需要我可以切回系統現場操作。"
)
header(s, 15, "05 · 下一步", "如果我們團隊要開始用，建議這樣走")
road = [
    ("STEP 1", "挑一個小案子試點", "內部工具、報表、展示用頁面\n風險低、做壞了不心痛", C_BLUE),
    ("STEP 2", "整理團隊共用範本", "AGENTS.md 守則、驗收清單、\nprompt 範本、commit 規則", C_PURPLE),
    ("STEP 3", "調整分工", "PM：規格 + 驗收\n工程師：架構 + 審查\nAI：實作 + 文件初稿", C_GREEN),
]
for i, (st, t, d, c) in enumerate(road):
    x = 0.7 + i * 4.02
    box(s, x, 1.65, 3.85, 2.75, fill=C_CARD, border=c, width=1.5)
    text(s, x + 0.2, 1.8, 3.4, 0.4, st, 12, c, True)
    text(s, x + 0.2, 2.2, 3.4, 0.6, t, 19, C_TEXT, True)
    text(s, x + 0.2, 2.9, 3.4, 1.4, d, 13, C_MUTED)
    if i < 2:
        text(s, x + 3.82, 2.7, 0.22, 0.6, "➜", 18, C_MUTED, True, PP_ALIGN.CENTER)
box(s, 0.7, 4.7, 11.93, 1.35, fill=C_TERM, border=C_ORANGE, width=1.5)
text(s, 0.95, 4.75, 11.5, 1.25, [("「AI 讓寫程式變便宜了，", C_TEXT, 22, True), ("但『知道要做什麼、做對了沒有』變得更值錢。」", C_ORANGE, 22, True)], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, spacing=2)
text(s, 0.7, 6.25, 11.93, 0.6, "Q & A　｜　需要的話可以切回系統現場操作", 18, C_BLUE, True, PP_ALIGN.CENTER)

prs.save(OUT)
print("已輸出：", OUT)
