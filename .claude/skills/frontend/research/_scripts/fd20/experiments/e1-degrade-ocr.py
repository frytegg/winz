"""E1: degrade the lossless captures the way a judge's copy is degraded, then OCR every string.

Conditions (all H.264 via libx264, yuv420p, BT.709 limited range, 2 s still loop at 30 fps, frame 30 decoded):
  ref      : lossless 1920x1080 PNG, no encode
  h1080c23 : 1920x1080, CRF 23 (x264 default quality)
  h720c23  : downscale to 1280x720 (bicubic), CRF 23
  h720c30  : downscale to 1280x720, CRF 30 (heavier compression)
  h540c23  : downscale to 960x540, CRF 23 (video shown at half size, or a 540p stream)
Every string is cropped from the decoded frame, upscaled x3 (Lanczos) identically in all conditions,
and read by the Windows.Media.Ocr engine (fr-FR is the only recogniser installed on this machine).
"""
import json, subprocess, os, re, sys
from pathlib import Path
from PIL import Image

LAB = Path(__file__).resolve().parent
OUT = LAB / 'out' / 'e1'
FR = OUT / 'frames'; FR.mkdir(parents=True, exist_ok=True)
CR = OUT / 'crops'; CR.mkdir(parents=True, exist_ok=True)
manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))

CONDS = {
    'ref': None,
    'h1080c23': (1920, 1080, 23),
    'h720c23': (1280, 720, 23),
    'h720c30': (1280, 720, 30),
    'h540c23': (960, 540, 23),
}

def encode_decode(png: Path, cond: str, w: int, h: int, crf: int) -> Path:
    mp4 = FR / f'{png.stem}.{cond}.mp4'
    out = FR / f'{png.stem}.{cond}.png'
    vf_enc = f'scale={w}:{h}:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', '2', '-i', str(png),
                    '-vf', vf_enc, '-c:v', 'libx264', '-preset', 'medium', '-crf', str(crf),
                    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
                    str(mp4)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(mp4), '-vf',
                    "select=eq(n\\,30),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24",
                    '-frames:v', '1', '-update', '1', str(out)], check=True)
    size = mp4.stat().st_size
    mp4.unlink()
    return out, size

rows = []
ocr_list = []
sizes_bytes = {}
for m in manifest:
    png = Path(m['file'])
    for cond, spec in CONDS.items():
        if spec is None:
            frame, scale = png, 1.0
        else:
            w, h, crf = spec
            frame, nbytes = encode_decode(png, cond, w, h, crf)
            sizes_bytes[f"{png.stem}.{cond}"] = nbytes
            scale = w / 1920
        im = Image.open(frame).convert('RGB')
        for i, b in enumerate(m['boxes']):
            pad = 6
            box = (max(0, (b['x'] - pad) * scale), max(0, (b['y'] - pad) * scale),
                   (b['x'] + b['w'] + pad) * scale, (b['y'] + b['h'] + pad) * scale)
            crop = im.crop(tuple(round(v) for v in box))
            f = 3.0 / scale  # every crop ends at 3x the 1080p size, whatever the condition
            crop = crop.resize((round(crop.width * f), round(crop.height * f)), Image.LANCZOS)
            cp = CR / f"{png.stem}.{cond}.{i:02d}.png"
            crop.save(cp)
            ocr_list.append(str(cp))
            rows.append({'variant': m['variant']['id'], 'cond': cond, 'size': b['size'], 'truth': b['text'], 'crop': str(cp)})

(OUT / 'ocr-list.txt').write_text('\n'.join(ocr_list), encoding='utf-8')
(OUT / 'rows.json').write_text(json.dumps(rows), encoding='utf-8')
(OUT / 'encoded-bytes.json').write_text(json.dumps(sizes_bytes, indent=1), encoding='utf-8')
print('crops', len(ocr_list))
