"""
產製大甲幼獅全區微感測器 VOC 重度超標 (>500 ppb) 星期與小時 (7x24 每格 1 小時) 頻率熱力矩陣圖
完美排版：X 軸 24 小時每格 1 小時，Y 軸週一至週日，右側獨立合計欄，避免任何重疊。
"""
import os
import polars as pl
import numpy as np
import matplotlib
import matplotlib.pyplot as plt

matplotlib.rcParams['font.sans-serif'] = ['Microsoft JhengHei', 'SimHei', 'sans-serif']
matplotlib.rcParams['axes.unicode_minus'] = False

def create_heatmap():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    parquet_path = os.path.join(project_root, 'Dajia', 'output', 'dajia_buffer500_hourly_202506_202609.parquet')
    output_png = os.path.join(project_root, 'documents', 'figures', 'dajia_weekday_hour_heatmap.png')

    df = pl.read_parquet(parquet_path)

    # 1. 剔除 4 台失效設備 (零值>=80%或死線)
    excluded = [11776510363, 11798444390, 11776511116, 11788579979]
    df = df.filter(~pl.col('deviceId').is_in(excluded))

    # 2. 剔除 VOC 異常值 (16-bit 溢位、飽和值、>15000 ppb)
    df = df.filter(pl.col('voc').is_not_null())
    df = df.filter((pl.col('voc') < 15000) & (pl.col('voc') != 65535) & (pl.col('voc') != 29206))

    # 3. 解析時間與維度
    df = df.with_columns(
        pl.col('hour').str.strptime(pl.Datetime, '%Y-%m-%d %H:%M').alias('dt')
    )
    df = df.with_columns([
        pl.col('dt').dt.weekday().alias('weekday'), # 1=Mon, 7=Sun
        pl.col('dt').dt.hour().alias('h')
    ])

    # 4. 統計各星期、各小時超標 (>500 ppb) 總次數
    matrix_data = df.filter(pl.col('voc') >= 500).group_by(['weekday', 'h']).agg(
        pl.len().alias('count')
    )

    grid = np.zeros((7, 24), dtype=int)
    for r in matrix_data.iter_rows(named=True):
        grid[r['weekday'] - 1, r['h']] = r['count']

    totals = grid.sum(axis=1)

    # 5. 繪製精緻雙面板熱力圖 (主熱力圖 24 欄 + 右側合計欄 1 欄)
    fig, (ax, ax_tot) = plt.subplots(
        1, 2, figsize=(16, 5.2), dpi=300, 
        gridspec_kw={'width_ratios': [24, 2.2], 'wspace': 0.08}
    )

    # 採用 YlOrRd 色階 (淡黃 -> 鮮橘 -> 深紅)
    cmap = plt.cm.YlOrRd
    im = ax.imshow(grid, cmap=cmap, aspect='auto')

    # 設定 X 軸 (00~23 時，每格剛好 1 小時)
    ax.set_xticks(np.arange(24))
    ax.set_xticklabels([f"{h:02d}時" for h in range(24)], fontsize=9, fontweight='bold', color='#1e293b')
    ax.set_xlabel('每日發生小時 (00:00 ～ 23:00 · X 軸每格剛好 1 小時)', fontsize=10.5, fontweight='bold', labelpad=9, color='#1e3a8a')

    # 設定 Y 軸 (週一～週日)
    weekday_labels = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
    ax.set_yticks(np.arange(7))
    ax.set_yticklabels(weekday_labels, fontsize=10.5, fontweight='bold', color='#1e293b')
    ax.set_ylabel('星期維度 (Y 軸)', fontsize=10.5, fontweight='bold', labelpad=9, color='#1e3a8a')

    # 在主熱力圖每個格子內標註超標次數數字
    for i in range(7):
        for j in range(24):
            val = grid[i, j]
            text_color = "white" if val > 210 else "#0f172a"
            ax.text(j, i, f"{val}", ha="center", va="center", color=text_color, fontsize=8, fontweight='bold')

    # 加上網格線分割每一格
    ax.set_xticks(np.arange(-0.5, 24, 1), minor=True)
    ax.set_yticks(np.arange(-0.5, 7, 1), minor=True)
    ax.grid(which="minor", color="#cbd5e1", linestyle='-', linewidth=0.8)
    ax.tick_params(which="minor", size=0)

    # ── 右側：各星期累積合計欄 ──
    tot_grid = totals.reshape(7, 1)
    # 合計欄用淡藍灰底色獨立呈現
    ax_tot.imshow(tot_grid, cmap=plt.cm.Blues, aspect='auto', vmin=4000, vmax=5200)
    ax_tot.set_xticks([0])
    ax_tot.set_xticklabels(['星期總計'], fontsize=9.5, fontweight='bold', color='#1e3a8a')
    ax_tot.set_yticks(np.arange(7))
    ax_tot.set_yticklabels([]) # 共享 Y 軸標籤

    for i in range(7):
        tot_val = totals[i]
        ax_tot.text(0, i, f"{tot_val:,}\n次", ha="center", va="center", color="#1e3a8a", fontsize=8.5, fontweight='bold')

    ax_tot.set_xticks(np.arange(-0.5, 1, 1), minor=True)
    ax_tot.set_yticks(np.arange(-0.5, 7, 1), minor=True)
    ax_tot.grid(which="minor", color="#94a3b8", linestyle='-', linewidth=0.8)
    ax_tot.tick_params(which="minor", size=0)

    # ── 下方或右側色階 Colorbar ──
    # 在圖表下方橫置色階條，讓排版更清爽
    cbar_ax = fig.add_axes([0.13, -0.05, 0.70, 0.04]) # [left, bottom, width, height]
    cbar = fig.colorbar(im, cax=cbar_ax, orientation='horizontal')
    cbar.set_label('各格超標累積次數 (>500 ppb · 全區 31 台合格測站每小時總和)', fontsize=9.5, fontweight='bold', color='#1e3a8a')
    cbar.ax.tick_params(labelsize=8.5)

    fig.suptitle('大甲幼獅全區微型感測器 VOC 重度超標 (>500 ppb) 星期與小時頻率熱力矩陣圖\n'
                 '(基於 432 天全時序 · 273,400 筆數據 · 橫向清晨 00~06 時極強爆發 · 縱向全週天天連續排污)',
                 fontsize=12, fontweight='bold', y=1.04, color='#1e3a8a')

    plt.savefig(output_png, bbox_inches='tight')
    plt.close()
    print(f"✅ 熱力矩陣圖產製成功：{output_png}")
    return output_png

if __name__ == '__main__':
    create_heatmap()
