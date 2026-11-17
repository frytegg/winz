"""FD16-F16: does a font support tabular figures? Run: python tnum_check.py FONT.ttf [FONT2.ttf ...]

Prints whether GSUB declares 'tnum' and whether the default digits already share one advance width.
A face with neither makes `font-variant-numeric: tabular-nums` a no-op. Requires fontTools.
"""
import sys
from fontTools.ttLib import TTFont

for path in sys.argv[1:]:
    font = TTFont(path, lazy=True)
    feats = set()
    if 'GSUB' in font and font['GSUB'].table.FeatureList:
        feats = {fr.FeatureTag for fr in font['GSUB'].table.FeatureList.FeatureRecord}
    cmap, hmtx = font.getBestCmap(), font['hmtx']
    widths = {hmtx[cmap[ord(str(d))]][0] for d in range(10)}
    ok = 'tnum' in feats or len(widths) == 1
    print(f"{font['name'].getDebugName(1):30s} tnum={'tnum' in feats} default_tabular={len(widths) == 1} -> {'OK' if ok else 'NO TABULAR FIGURES'}")
