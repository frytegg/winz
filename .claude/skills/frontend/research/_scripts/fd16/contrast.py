"""FD16-F28: WCAG 2 contrast of kit default token pairs (shadcn neutral theme, Tailwind 4.3.3).

Values are copied from shadcn apps/v4/content/docs/(root)/theming.mdx and tailwindcss@4.3.3/theme.css
(accessed 2026-09-30). Run: python contrast.py
"""
import math


def oklch_to_linear_srgb(L: float, C: float, H: float) -> list[float]:
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )
    return [min(1.0, max(0.0, x)) for x in rgb]  # naive gamut clip


def enc(x: float) -> float:
    return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055


def dec(x: float) -> float:
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def over(fg: list[float], alpha: float, bg: list[float]) -> list[float]:
    """Alpha-composite in gamma-encoded sRGB, as browsers do by default."""
    return [dec(alpha * enc(f) + (1 - alpha) * enc(b)) for f, b in zip(fg, bg)]


def ratio(c1: list[float], c2: list[float]) -> float:
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    hi, lo = sorted((lum(c1), lum(c2)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def hexlin(h: str) -> list[float]:
    h = h.lstrip('#')
    return [dec(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


ok = lambda L, C=0.0, H=0.0: oklch_to_linear_srgb(L, C, H)
WHITE = [1.0, 1.0, 1.0]
TW = {  # tailwindcss@4.3.3 theme.css
    'zinc-500': ok(0.552, 0.016, 285.938), 'zinc-950': ok(0.141, 0.005, 285.823),
    'blue-500': ok(0.623, 0.214, 259.815), 'violet-500': ok(0.606, 0.25, 292.717),
    'indigo-500': ok(0.585, 0.233, 277.117),
}
PAIRS = [
    ('shadcn dark muted-foreground 0.708 on background 0.145', ok(0.708), ok(0.145)),
    ('shadcn dark muted-foreground 0.708 on card 0.205', ok(0.708), ok(0.205)),
    ('shadcn light muted-foreground 0.556 on background 1.0', ok(0.556), ok(1.0)),
    ('shadcn light muted-foreground 0.556 on muted 0.97', ok(0.556), ok(0.97)),
    ('white on tailwind blue-500', WHITE, TW['blue-500']),
    ('white on tailwind violet-500', WHITE, TW['violet-500']),
    ('white on tailwind indigo-500', WHITE, TW['indigo-500']),
    ('tailwind zinc-500 on zinc-950', TW['zinc-500'], TW['zinc-950']),
    ('shadcn dark --input (white 15%) over 0.145 [non-text]', over(WHITE, 0.15, ok(0.145)), ok(0.145)),
    ('shadcn light --input 0.922 on white [non-text]', ok(0.922), ok(1.0)),
    ('CHECK #767676 on white (known 4.54)', hexlin('#767676'), WHITE),
]
if __name__ == '__main__':
    for name, a, b in PAIRS:
        print(f'{ratio(a, b):5.2f}:1  {name}')
