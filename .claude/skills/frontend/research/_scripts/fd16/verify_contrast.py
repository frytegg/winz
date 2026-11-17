# FD16 verification (2026-09-30): independent re-computation of the F28 WCAG ratios from OKLCH (Ottosson matrices, sRGB clipping). Run: python verify_contrast.py
import math
def oklch_to_linear_srgb(L, C, h):
    a = C*math.cos(math.radians(h)); b = C*math.sin(math.radians(h))
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return (r, g, bb)
def lin_to_srgb(c):
    c = min(max(c, 0.0), 1.0)
    return 12.92*c if c <= 0.0031308 else 1.055*c**(1/2.4) - 0.055
def srgb_to_lin(c):
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def lum_from_srgb(rgb):
    r,g,b = [srgb_to_lin(c) for c in rgb]
    return 0.2126*r + 0.7152*g + 0.0722*b
def oklch_srgb(L,C,h):
    lin = oklch_to_linear_srgb(L,C,h)
    oog = any(x < -1e-6 or x > 1+1e-6 for x in lin)
    return tuple(lin_to_srgb(x) for x in lin), oog
def ratio(l1,l2):
    a,b = max(l1,l2), min(l1,l2); return (a+0.05)/(b+0.05)
def hexrgb(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def tohex(rgb): return '#'+''.join(f'{round(c*255):02x}' for c in rgb)
white=(1,1,1)
# validations
print('#767676 on white', round(ratio(lum_from_srgb(hexrgb('#767676')), 1.0),2))
z950,_=oklch_srgb(0.141,0.005,285.823); print('zinc-950 ->', tohex(z950))
print('v3 blue-500 #3b82f6 on white', round(ratio(lum_from_srgb(hexrgb('#3b82f6')),1.0),2))
def L(Lc,C=0,h=0):
    rgb,oog=oklch_srgb(Lc,C,h); return lum_from_srgb(rgb), oog, tohex(rgb)
pairs = [
 ('dark muted-fg 0.708 on bg 0.145', L(0.708), L(0.145)),
 ('dark muted-fg 0.708 on card 0.205', L(0.708), L(0.205)),
 ('light muted-fg 0.556 on muted 0.97', L(0.556), L(0.97)),
 ('white on blue-500', (1.0,False,'#fff'), L(0.623,0.214,259.815)),
 ('white on violet-500', (1.0,False,'#fff'), L(0.606,0.25,292.717)),
 ('white on indigo-500', (1.0,False,'#fff'), L(0.585,0.233,277.117)),
 ('zinc-500 on zinc-950', L(0.552,0.016,285.938), L(0.141,0.005,285.823)),
 ('light input 0.922 on white', L(0.922), (1.0,False,'#fff')),
]
for name,(l1,o1,h1),(l2,o2,h2) in pairs:
    print(f'{name:38s} {ratio(l1,l2):.2f}:1  fg={h1} bg={h2} out_of_gamut={o1 or o2}')
# dark input: white at 15% over bg 0.145, composited in sRGB (gamma-encoded) space
bg,_=oklch_srgb(0.145,0,0)
comp=tuple(0.15*1.0+0.85*c for c in bg)
print('dark input 15% white over 0.145 (sRGB composite)', f'{ratio(lum_from_srgb(comp), lum_from_srgb(bg)):.2f}:1', tohex(comp), 'vs bg', tohex(bg))
