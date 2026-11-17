# FD16 verification (2026-09-30): independent tnum / default-digit-width check. Run inside a folder of .ttf files: python verify_tnum.py
import sys, glob
from fontTools.ttLib import TTFont
for path in sorted(glob.glob("*.ttf")):
    f = TTFont(path)
    feats = set()
    if 'GSUB' in f and f['GSUB'].table.FeatureList:
        feats = {fr.FeatureTag for fr in f['GSUB'].table.FeatureList.FeatureRecord}
    cmap = f.getBestCmap(); hmtx = f['hmtx']
    w = [hmtx[cmap[ord(str(d))]][0] for d in range(10)]
    hv = 'HVAR' in f
    print(f"{f['name'].getDebugName(1):22s} tnum={'tnum' in feats!s:5s} pnum={'pnum' in feats!s:5s} lnum={'lnum' in feats!s:5s} onum={'onum' in feats!s:5s} zero={'zero' in feats!s:5s} default_tabular={len(set(w))==1!s:5s} digit_widths={sorted(set(w))} HVAR={hv}")
