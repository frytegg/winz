import json, re
from pathlib import Path
from collections import defaultdict

OUT = Path(__file__).resolve().parent / 'out' / 'e1'
rows = json.loads((OUT / 'rows.json').read_text(encoding='utf-8'))
ocr = json.loads((OUT / 'ocr.json').read_text(encoding='utf-8-sig'))
assert len(rows) == len(ocr)

def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

NUM = re.compile(r'\d{1,3}(?:,\d{3})*\.\d{2}')
agg = defaultdict(lambda: {'n': 0, 'err': 0, 'chars': 0, 'num_ok': 0})
for r, o in zip(rows, ocr):
    truth = norm(r['truth']); got = norm(o['text'] or '')
    e = lev(truth, got)
    num = NUM.search(truth).group(0)
    ok = num in got.replace(' ', '')  # tolerate OCR splitting thousands groups with spaces
    k = (r['variant'], r['cond'], r['size'])
    a = agg[k]; a['n'] += 1; a['err'] += e; a['chars'] += len(truth); a['num_ok'] += ok
    r['got'] = got; r['cer'] = e / len(truth); r['num_ok'] = ok

variants = sorted({r['variant'] for r in rows}); conds = ['ref', 'h1080c23', 'h720c23', 'h720c30', 'h540c23']
sizes = sorted({r['size'] for r in rows})
table = {}
for v in variants:
    print('\n==', v)
    print('size ' + ' '.join(f'{c:>16}' for c in conds))
    for s in sizes:
        cells = []
        for c in conds:
            a = agg[(v, c, s)]
            cer = a['err'] / a['chars']
            cells.append(f"{cer*100:5.1f}% n{a['num_ok']}/{a['n']}")
            table[f'{v}|{c}|{s}'] = {'cer': round(cer, 4), 'num_ok': a['num_ok'], 'n': a['n']}
        print(f'{s:>4} ' + ' '.join(f'{x:>16}' for x in cells))
(OUT / 'score.json').write_text(json.dumps(table, indent=1), encoding='utf-8')
(OUT / 'rows-scored.json').write_text(json.dumps(rows, indent=1), encoding='utf-8')
