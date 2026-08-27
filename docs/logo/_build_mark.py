#!/usr/bin/env python3
"""Guild mark B — G closing into @. Geometric source of truth."""
from __future__ import annotations

import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
S = 1024
C = 512.0


def f(n: float) -> str:
    s = f"{n:.3f}".rstrip("0").rstrip(".")
    return s if s != "-0" else "0"


def polar(r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return (C + r * math.cos(a), C + r * math.sin(a))


def P(r: float, deg: float) -> str:
    x, y = polar(r, deg)
    return f"{f(x)} {f(y)}"


# --- Badge metrics (1024). Tuned so enamel gap ≥ 2px at 32. ---
RING_OUT = 512  # flush: GitHub circle crop = the metal edge
RING_HIGH = 492
RING_LOW = 458
RING_IN = 444
ENAMEL = 432

STROKE = 96
G_R = 118
AT_R = 278
# gap at 1024 = (AT_R - STROKE/2) - (G_R + STROKE/2) = 278-48-118-48 = 64 → 2.0px @32

OPEN = 40  # G opening half-angle from +x, degrees
AT_STOP = 12  # outer tail terminal, leaves a gap on the right

G_LO, G_HI = OPEN, -OPEN  # 40° and -40°
# Inner G: long CCW arc from lower lip to upper lip.
# Outer @: long CW arc from lower lip to AT_STOP (almost full wrap).


STEEL = """
    <linearGradient id="steel" x1="160" y1="40" x2="880" y2="980" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#F7F8FA"/>
      <stop offset="18%" stop-color="#D8DCE3"/>
      <stop offset="46%" stop-color="#8E949E"/>
      <stop offset="62%" stop-color="#C4C8D0"/>
      <stop offset="82%" stop-color="#A8ADB6"/>
      <stop offset="100%" stop-color="#E8EAEE"/>
    </linearGradient>
    <linearGradient id="steel-dim" x1="200" y1="120" x2="820" y2="900" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#B8BDC6"/>
      <stop offset="50%" stop-color="#6E747E"/>
      <stop offset="100%" stop-color="#C9CED6"/>
    </linearGradient>
    <linearGradient id="mark" x1="280" y1="240" x2="760" y2="820" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#F4F5F7"/>
      <stop offset="45%" stop-color="#C5CAD2"/>
      <stop offset="100%" stop-color="#8B909A"/>
    </linearGradient>
    <radialGradient id="enamel" cx="46%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#161A22"/>
      <stop offset="55%" stop-color="#0B0E12"/>
      <stop offset="100%" stop-color="#07090C"/>
    </radialGradient>
"""


def rivets(r: float = 468.0, size: float = 11.0) -> str:
    parts = []
    for deg in (90, 0, -90, 180):
        x, y = polar(r, deg)
        parts.append(
            f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(size)}" fill="url(#steel)" stroke="#6E747E" stroke-width="1.6"/>'
        )
    return "\n    ".join(parts)


def mark_group() -> str:
    # Inner G bowl: from lower lip CCW (sweep 0) the long way to upper lip.
    # SVG: start G_LO, A rx ry 0 1 0 end  → large-arc, CCW
    g_start = P(G_R, G_LO)
    g_end = P(G_R, G_HI)
    at_start = P(AT_R, G_LO)
    at_end = P(AT_R, AT_STOP)

    # G spur: horizontal bar at optical center, same weight as stroke.
    # Sits in the opening; short beard so it reads G not C.
    bar_h = STROKE * 0.92
    bar_y0 = C - bar_h / 2
    bar_y1 = C + bar_h / 2
    bar_x0 = C + 18
    bar_x1 = C + G_R + STROKE * 0.42  # into the opening, not through the @ gap
    beard_w = STROKE * 0.72
    beard_h = STROKE * 0.55
    beard_x0 = bar_x1 - beard_w
    beard_x1 = bar_x1
    beard_y1 = bar_y1 + beard_h

    return f"""
    <g fill="none" stroke="url(#mark)" stroke-width="{STROKE}" stroke-linejoin="round">
      <!-- inner G -->
      <path d="M {g_start} A {f(G_R)} {f(G_R)} 0 1 0 {g_end}" stroke-linecap="butt"/>
      <!-- join (the hook) -->
      <path d="M {g_start} L {at_start}" stroke-linecap="butt"/>
      <!-- @ tail, large clockwise wrap -->
      <path d="M {at_start} A {f(AT_R)} {f(AT_R)} 0 1 1 {at_end}" stroke-linecap="round"/>
    </g>
    <path fill="url(#mark)" d="
      M {f(bar_x0)} {f(bar_y0)}
      H {f(bar_x1)}
      V {f(beard_y1)}
      H {f(beard_x0)}
      V {f(bar_y1)}
      H {f(bar_x0)}
      Z"/>
"""


def badge(inset: float = 0.0, with_rivets: bool = True) -> str:
    """inset > 0 shrinks the whole seal toward center (README mark, not avatar)."""
    k = (RING_OUT - inset) / RING_OUT if inset else 1.0
    # Simpler: draw at full size then scale from center.
    riv = rivets() if with_rivets else ""
    inner = f"""
    <circle cx="{C}" cy="{C}" r="{RING_OUT}" fill="url(#steel)"/>
    <circle cx="{C}" cy="{C}" r="{RING_HIGH}" fill="url(#steel-dim)"/>
    <circle cx="{C}" cy="{C}" r="{RING_LOW}" fill="url(#steel)"/>
    <circle cx="{C}" cy="{C}" r="{RING_IN}" fill="url(#steel-dim)"/>
    <circle cx="{C}" cy="{C}" r="{ENAMEL}" fill="url(#enamel)"/>
    <circle cx="{C}" cy="{C}" r="{ENAMEL}" fill="none" stroke="#C5C9D1" stroke-width="6" opacity=".45"/>
    {riv}
    {mark_group()}
"""
    if inset:
        s = (S - 2 * inset) / S
        return f'<g transform="translate({C} {C}) scale({f(s)}) translate({-C} {-C})">{inner}</g>'
    return inner


def svg(body: str, bg: str | None, title: str) -> str:
    bg_el = f'<rect width="{S}" height="{S}" fill="{bg}"/>' if bg else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}" role="img" aria-label="{title}">
  <title>{title}</title>
  <defs>{STEEL}</defs>
  {bg_el}
  {body}
</svg>
"""


def favicon_32() -> str:
    # Designed in 32 space. Filled forms, not scaled master.
    return """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Guild">
  <title>Guild</title>
  <rect width="32" height="32" fill="#0B0E12"/>
  <circle cx="16" cy="16" r="16" fill="#C5C9D1"/>
  <circle cx="16" cy="16" r="12.2" fill="#0B0E12"/>
  <g fill="none" stroke="#D7DBE2" stroke-width="2.6">
    <path d="M 19.6 18.9 A 3.55 3.55 0 1 1 19.7 13.1" stroke-linecap="butt"/>
    <path d="M 19.6 18.9 L 22.6 21.05" stroke-linecap="butt"/>
    <path d="M 22.6 21.05 A 8.05 8.05 0 1 1 23.9 17.2" stroke-linecap="round"/>
  </g>
  <path fill="#D7DBE2" d="M16.4 14.7 H21.3 V19.9 H19.4 V17.3 H16.4 Z"/>
</svg>
"""


def favicon_16() -> str:
    # 16px: drop the @ tail. G-in-ring. Honest at the failure line.
    return """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Guild">
  <title>Guild</title>
  <rect width="16" height="16" fill="#0B0E12"/>
  <circle cx="8" cy="8" r="8" fill="#C5C9D1"/>
  <circle cx="8" cy="8" r="5.85" fill="#0B0E12"/>
  <path fill="none" stroke="#D7DBE2" stroke-width="2" stroke-linecap="butt"
        d="M 10.15 10.05 A 2.85 2.85 0 1 1 10.2 5.95"/>
  <path fill="#D7DBE2" d="M8.15 7.05 H11.05 V10.15 H9.7 V8.95 H8.15 Z"/>
</svg>
"""


def main() -> None:
    (OUT / "B-g-monogram.svg").write_text(
        svg(badge(inset=36, with_rivets=True), bg=None, title="Guild — G closing into @")
    )
    (OUT / "B-g-monogram-dark.svg").write_text(
        svg(badge(inset=36, with_rivets=True), bg="#0B0E12", title="Guild — G closing into @ (dark)")
    )
    (OUT / "B-g-monogram-light.svg").write_text(
        svg(badge(inset=36, with_rivets=True), bg="#F3EFE6", title="Guild — G closing into @ (light)")
    )
    (OUT / "B-g-monogram-avatar.svg").write_text(
        svg(badge(inset=0, with_rivets=True), bg="#0B0E12", title="Guild — GitHub avatar")
    )
    (OUT / "favicon.svg").write_text(favicon_32())
    (OUT / "favicon-16.svg").write_text(favicon_16())
    print("svg ok")
    print("gap@1024", (AT_R - STROKE / 2) - (G_R + STROKE / 2))
    print("gap@32", ((AT_R - STROKE / 2) - (G_R + STROKE / 2)) * 32 / 1024)
    print("stroke@32", STROKE * 32 / 1024)


if __name__ == "__main__":
    main()
