"""E2/E3 measurements.
E2: CAMBI (Netflix banding index, via ffmpeg libvmaf feature=cambi) and luma step analysis for hero backgrounds,
    lossless vs H.264 (libx264, yuv420p, BT.709 limited) at 1080p CRF 23, 720p CRF 23, 720p CRF 30.
E3: what a grain overlay costs: bytes at CRF 23, text-region SSIM at a fixed 2 Mbps, and grain survival.
"""
import json, subprocess, re
from pathlib import Path
import numpy as np
from PIL import Image

LAB = Path(__file__).resolve().parent
OUT = LAB / 'out' / 'e2'
TMP = OUT / 'tmp'; TMP.mkdir(exist_ok=True)

def run(args, cwd=None):
    subprocess.run(args, check=True, cwd=cwd)

def encode(src, dst, w, h, crf=None, bitrate=None, still=True):
    inp = ['-loop', '1', '-framerate', '30', '-t', '2', '-i', str(src)] if still else ['-i', str(src)]
    vf = f'scale={w}:{h}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p'
    rc = ['-crf', str(crf)] if crf is not None else ['-b:v', bitrate, '-maxrate', bitrate, '-bufsize', str(int(bitrate[:-1]) * 2) + 'M']
    run(['ffmpeg', '-v', 'error', '-y', *inp, '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', *rc,
         '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', str(dst)])
    return dst.stat().st_size

def cambi(video, w, h, enc_w=None, enc_h=None):
    log = TMP / 'cambi.json'
    graph = (f'[0:v]scale={w}:{h}:flags=bicubic,format=yuv420p[a];[1:v]scale={w}:{h}:flags=bicubic,format=yuv420p[b];'
             f'[a][b]libvmaf=feature=name=cambi:log_path=cambi.json:log_fmt=json')
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-i', str(video), '-lavfi', graph, '-f', 'null', '-'], cwd=TMP)
    d = json.loads(log.read_text())
    vals = [f['metrics']['cambi'] for f in d['frames']]
    return round(float(np.mean(vals)), 3)

def luma_frame(video_or_png, n=30):
    png = TMP / 'frame.png'
    if str(video_or_png).endswith('.png'):
        im = Image.open(video_or_png).convert('RGB')
    else:
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(video_or_png), '-vf',
             f"select=eq(n\\,{n}),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24", '-frames:v', '1', '-update', '1', str(png)])
        im = Image.open(png).convert('RGB')
    a = np.asarray(im).astype(np.float64)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def steps(col):
    """Runs of identical 8-bit values along a column: number of distinct levels, median and max run length."""
    v = np.round(col).astype(int)
    runs, cur = [], 1
    for i in range(1, len(v)):
        if v[i] == v[i - 1]: cur += 1
        else: runs.append(cur); cur = 1
    runs.append(cur)
    return {'levels': int(len(set(v.tolist()))), 'median_run': float(np.median(runs)), 'max_run': int(max(runs))}

results = {}
for png in []:
    rid = png.stem
    r = {'src_cambi': cambi(png, 1920, 1080)}
    y = luma_frame(png)
    r['src_col'] = steps(y[:, 1700])
    for cond, (w, h, crf) in {'h1080c23': (1920, 1080, 23), 'h720c23': (1280, 720, 23), 'h720c30': (1280, 720, 30)}.items():
        mp4 = TMP / f'{rid}.{cond}.mp4'
        r[f'{cond}_bytes'] = encode(png, mp4, w, h, crf=crf)
        r[f'{cond}_cambi'] = cambi(mp4, w, h)
        yl = luma_frame(mp4)
        r[f'{cond}_col'] = steps(yl[:, int(1700 * w / 1920)])
        mp4.unlink()
    results[rid] = r
    print(rid, json.dumps(r))

# E3: grain overlay cost and effect on text
def hp_std(y, box):
    x0, y0, x1, y1 = box
    reg = y[y0:y1, x0:x1]
    k = 5
    pad = np.pad(reg, k // 2, mode='edge')
    blur = np.zeros_like(reg)
    for dy in range(k):
        for dx in range(k):
            blur += pad[dy:dy + reg.shape[0], dx:dx + reg.shape[1]]
    blur /= k * k
    return round(float(np.std(reg - blur)), 3)

def ssim_text(enc, src):
    log = TMP / 'ssim.txt'
    # text block at 1280x720: h1 72px at top 380, p 24px at top 490 -> crop x 100..1180, y 370..525
    graph = (f"[0:v]scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=gray,crop=1080:155:100:370[a];"
             f"[1:v]format=gray,crop=1080:155:100:370[b];[a][b]ssim=stats_file=ssim.txt")
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(enc), '-i', str(src), '-lavfi', graph, '-f', 'null', '-'], cwd=TMP)
    vals = [float(re.search(r'All:([0-9.]+)', l).group(1)) for l in log.read_text().splitlines() if 'All:' in l]
    return round(float(np.mean(vals)), 4)

e3 = {}
for mkv in sorted(OUT.glob('e3-*.720.mkv')):
    rid = mkv.stem.replace('.720', '')
    r = {}
    crf_mp4 = TMP / f'{rid}.crf23.mp4'
    r['crf23_bytes_1s'] = encode(mkv, crf_mp4, 1280, 720, crf=23, still=False)
    br_mp4 = TMP / f'{rid}.2M.mp4'
    r['cbr2M_bytes_1s'] = encode(mkv, br_mp4, 1280, 720, bitrate='2M', still=False)
    r['cbr2M_text_ssim'] = ssim_text(br_mp4, mkv)
    r['crf23_text_ssim'] = ssim_text(crf_mp4, mkv)
    src_y = luma_frame(mkv, n=15) if False else None
    # grain survival in a flat region (bottom-right), frame 15
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(mkv), '-vf', "select=eq(n\\,15)", '-frames:v', '1', '-update', '1', str(TMP / 'src15.png')])
    ys = luma_frame(TMP / 'src15.png')
    box = (900, 500, 1200, 680)
    r['grain_hp_std_src'] = hp_std(ys, box)
    r['grain_hp_std_cbr2M'] = hp_std(luma_frame(br_mp4, n=15), box)
    r['grain_hp_std_crf23'] = hp_std(luma_frame(crf_mp4, n=15), box)
    crf_mp4.unlink(); br_mp4.unlink()
    e3[rid] = r
    print(rid, json.dumps(r))

(OUT / 'e3-results.json').write_text(json.dumps({'e2': results, 'e3': e3}, indent=1), encoding='utf-8')
