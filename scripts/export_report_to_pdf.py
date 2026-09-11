"""
將大甲幼獅工業區微型感測器異味污染物報告 HTML 轉為高品質向量 PDF
使用系統內建 Google Chrome 或 Microsoft Edge 無頭模式渲染
"""
import os
import sys
import subprocess
import time

def export_pdf():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    html_path = os.path.join(project_root, 'documents', '10_Dajia_Odor_VOC_Hotspot_Investigation_Report.html')
    pdf_path = os.path.join(project_root, 'documents', '10_Dajia_Odor_VOC_Hotspot_Investigation_Report.pdf')

    if not os.path.exists(html_path):
        print(f"錯誤：找不到 HTML 檔案：{html_path}")
        return False

    # 尋找 Chrome 或 Edge 執行檔路徑
    browser_candidates = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe')
    ]

    browser_bin = None
    for candidate in browser_candidates:
        if os.path.exists(candidate):
            browser_bin = candidate
            break

    if not browser_bin:
        print("錯誤：系統中未找到 Chrome 或 Edge 瀏覽器！")
        return False

    print(f"使用瀏覽器引擎：{browser_bin}")
    print(f"來源 HTML：{html_path}")
    print(f"輸出目標 PDF：{pdf_path}")

    # 使用無頭模式輸出 PDF，配置充足的虛擬時間確保 Leaflet 地圖圖磚與 Chart.js 完全繪製
    cmd = [
        browser_bin,
        '--headless=new',
        '--disable-gpu',
        '--run-all-compositor-stages-before-draw',
        '--virtual-time-budget=15000',
        '--no-pdf-header-footer',
        f'--print-to-pdf={pdf_path}',
        html_path
    ]

    print("正在渲染並生成 PDF（含圖磚載入與圖表繪製）...")
    start_time = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - start_time

    if result.returncode == 0 and os.path.exists(pdf_path):
        file_size_mb = os.path.getsize(pdf_path) / (1024 * 1024)
        print(f"✅ PDF 生成成功！耗時 {elapsed:.2f} 秒，檔案大小：{file_size_mb:.2f} MB")
        return True
    else:
        print(f"❌ PDF 生成失敗，回傳碼：{result.returncode}")
        print("標準輸出：", result.stdout)
        print("標準錯誤：", result.stderr)
        return False

if __name__ == '__main__':
    export_pdf()
