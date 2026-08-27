# Guild · Mark B

> Locked 2026-08-27. Source of geometry: `_build_mark.py`.
> Concept stills: `A-at-seal.jpg` / `B-g-monogram.jpg` / `C-five-seats.jpg` — exploration, not production.

## What it is

A 1:1 guild **badge**: round seal, steel ring, black enamel.
The mark is a **G that closes into an `@` hook**.

Product is a local bench you `@mention`. The hook is the product. It is not a tavern crest, not a five-color pie, not a letter G in a circle.

## Files

| File | Use |
|---|---|
| `B-g-monogram.svg` | Master. Transparent field, inset ring. Print / README / deck. |
| `B-g-monogram-dark.svg` | Dark field `#0B0E12`. |
| `B-g-monogram-light.svg` | Light field `#F3EFE6`. |
| `B-g-monogram-avatar.svg` | GitHub / circle crop. Ring flush to the square. |
| `github-avatar-1024.png` | Raster of the avatar, 1024×1024. |
| `favicon.svg` | 32px optical. G + `@` tail. |
| `favicon-16.svg` | 16px optical. G only. |
| `favicon-32.png` / `favicon-16.png` | Rasters of the optical drawings. |

Do not scale the 1024 master down to 16. Use the optical files.

## Colour

| Token | Hex | Why |
|---|---|---|
| Enamel | `#0B0E12` | Black field. Not GitHub `#0D1117`. |
| Steel light | `#F4F5F7` → `#8B909A` | Brushed ring, not chrome rainbow. |
| Steel dim | `#6E747E` | Inner bevel. |
| Paper | `#F3EFE6` | Light field. Warm, so the steel stays cool. |
| Mark | same steel gradient | G and `@` are metal sitting in enamel, not a white glyph. |

No seat colours on the mark. Purple / blue / green / orange / magenta stay on the five seats, not on the badge.

## Geometry (1024)

- Ring outer = 512 (avatar) or inset 36 (master)
- Enamel radius 432
- G radius 118, `@` radius 278, stroke 96
- Enamel gap between G and `@` = 64px → **2px at 32**
- G opening ±40° on the right; `@` tail stops at 12° so the gap reads

## Optical rules

| Size | Drawing | Why |
|---|---|---|
| ≥64 | Master | Full hook, rivets, double bevel. |
| 32 | `favicon.svg` | Thicker stroke, no rivets, no double ring. G + tail. |
| 16 | `favicon-16.svg` | Drop the `@` tail. A G in a ring still reads; a spiral does not. |

## Don't

- Recolour the enamel with seat colours
- Add “Guild” inside the ring
- Use the photoreal JPG in UI / favicon
- Draw a second ring as decoration — the `@` tail already is that ring
- Stretch. The crop is a circle; the artboard is 1:1

## Next (not this folder)

- Daemon tab: `<link rel="icon">` → `/favicon.ico` first (Safari / default probe), then `/favicon.svg` (optical 32). PNG fallbacks `/favicon-32.png` / `/favicon-16.png`.
- GitHub user avatar is `Jakevin`’s face; this PNG is for an org, or for the local UI
- README: 128×128 master SVG above the title. GIF stays the first screen of the product.
