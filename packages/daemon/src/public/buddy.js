/* 18×32 tavern buddy. Handle-seeded hair/skin/cloth + outline. Not a cast. */
(function (root) {
  "use strict";
  const W = 18;
  const H = 32;
  const OUT = [27, 21, 16];
  const SHOE = [
    [44, 36, 32],
    [62, 44, 34],
  ];
  const PANTS = [
    [42, 48, 62],
    [58, 48, 40],
    [46, 58, 48],
    [72, 64, 58],
  ];
  const HAIR_RGB = [
    [42, 28, 18],
    [22, 18, 16],
    [196, 163, 90],
    [122, 52, 44],
    [58, 72, 108],
    [88, 56, 140],
    [154, 86, 46],
    [72, 44, 58],
  ];
  const SKIN = [
    { hi: [255, 221, 189], base: [247, 201, 170], sh: [212, 158, 126], line: [168, 112, 82] },
    { hi: [232, 182, 136], base: [214, 162, 116], sh: [176, 126, 86], line: [138, 92, 60] },
    { hi: [196, 148, 108], base: [176, 128, 90], sh: [140, 98, 68], line: [104, 70, 48] },
    { hi: [168, 118, 86], base: [146, 100, 70], sh: [112, 76, 52], line: [80, 54, 36] },
    { hi: [130, 90, 64], base: [108, 74, 52], sh: [82, 56, 38], line: [56, 38, 26] },
  ];
  const L = 4;
  const R = 13;

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  function shades(rgb, hi = 1.22, lo = 0.68) {
    return [
      [clamp(rgb[0] * hi), clamp(rgb[1] * hi), clamp(rgb[2] * hi)],
      rgb,
      [clamp(rgb[0] * lo), clamp(rgb[1] * lo), clamp(rgb[2] * lo)],
    ];
  }
  function parseHex(hex) {
    const h = String(hex || "#7c6af7").replace("#", "");
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
    return [
      parseInt(full.slice(0, 2), 16) || 120,
      parseInt(full.slice(2, 4), 16) || 100,
      parseInt(full.slice(4, 6), 16) || 90,
    ];
  }
  function set(buf, x, y, c, a = 255) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = a;
  }
  function alpha(buf, x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return 0;
    return buf[(y * W + x) * 4 + 3];
  }
  function rect(buf, x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(buf, x, y, c);
  }
  function dots(buf, pts, c) {
    for (const [x, y] of pts) set(buf, x, y, c);
  }

  function drawHead(buf, s) {
    for (let y = 4; y <= 16; y++) {
      for (let x = L; x <= R; x++) {
        if ((x === L || x === R) && (y === 4 || y === 16)) continue;
        if ((x === L + 1 || x === R - 1) && y === 4) continue;
        set(buf, x, y, s.base);
      }
    }
    for (let y = 6; y <= 11; y++) set(buf, 5, y, s.hi);
    set(buf, 6, 5, s.hi);
    set(buf, 7, 5, s.hi);
    for (let y = 6; y <= 15; y++) set(buf, 12, y, s.sh);
    for (const x of [7, 8, 9, 10, 11]) set(buf, x, 16, s.sh);
    set(buf, 3, 9, s.base);
    set(buf, 3, 10, s.base);
    set(buf, 3, 11, s.sh);
    set(buf, 14, 9, s.base);
    set(buf, 14, 10, s.base);
    set(buf, 14, 11, s.sh);
    rect(buf, 7, 17, 10, 18, s.sh);
    rect(buf, 7, 17, 9, 17, s.base);
  }

  function drawFace(buf, s, brow, mouth, blush, lashes) {
    const white = [250, 248, 244];
    const pup = [46, 38, 42];
    const glint = [252, 250, 248];
    const lash = [54, 40, 48];
    const lip = [158, 86, 80];
    set(buf, 5, 9, white);
    set(buf, 6, 9, pup);
    set(buf, 10, 9, pup);
    set(buf, 11, 9, white);
    set(buf, 5, 9, glint);
    if (lashes) {
      for (const x of [5, 6, 10, 11]) set(buf, x, 8, lash);
      set(buf, 4, 8, lash);
      set(buf, 12, 8, lash);
      set(buf, 10, 9, glint);
    }
    if (brow === 0) for (const x of [5, 6, 10, 11]) set(buf, x, 7, s.line);
    else if (brow === 1) {
      set(buf, 5, 8, s.line);
      set(buf, 6, 7, s.line);
      set(buf, 10, 7, s.line);
      set(buf, 11, 8, s.line);
    } else if (brow === 2) for (const x of [5, 6, 10, 11]) set(buf, x, 6, s.line);
    else {
      set(buf, 5, 7, s.line);
      set(buf, 11, 7, s.line);
      set(buf, 6, 7, s.sh);
      set(buf, 10, 7, s.sh);
    }
    set(buf, 8, 11, s.sh);
    set(buf, 8, 12, s.sh);
    set(buf, 7, 12, s.sh);
    const mouths = [
      [[7, 14], [8, 14], [9, 14], [10, 14]],
      [[7, 14], [8, 14], [9, 14], [10, 14], [6, 13], [11, 13]],
      [[7, 15], [8, 15], [9, 15], [10, 15]],
      [[6, 14], [7, 14], [8, 14], [9, 14], [10, 14], [11, 14], [6, 13], [11, 13]],
    ];
    dots(buf, mouths[mouth], lip);
    if (blush) {
      set(buf, 5, 12, [228, 140, 128]);
      set(buf, 12, 12, [228, 140, 128]);
    }
  }

  function hairShort(buf, hi, base, sh) {
    rect(buf, L, 2, R, 4, base);
    rect(buf, L - 1, 3, R + 1, 5, base);
    for (let y = 6; y <= 8; y++) {
      set(buf, L - 1, y, base);
      set(buf, L, y, base);
      set(buf, R, y, base);
      set(buf, R + 1, y, base);
    }
    for (let x = L; x <= R; x++) set(buf, x, 5, base);
    for (let y = 2; y <= 5; y++) set(buf, 8, y, sh);
    for (let x = L; x <= 7; x++) if (alpha(buf, x, 2)) set(buf, x, 2, hi);
    for (let x = L; x <= 7; x++) if (alpha(buf, x, 3)) set(buf, x, 3, hi);
  }
  function hairFringe(buf, hi, base, sh, skinBase) {
    hairShort(buf, hi, base, sh);
    rect(buf, 6, 6, 11, 6, base);
    set(buf, 8, 6, skinBase);
    set(buf, 9, 6, skinBase);
    set(buf, 7, 6, hi);
    set(buf, 10, 6, base);
  }
  function hairLong(buf, hi, base, sh, skinBase) {
    hairShort(buf, hi, base, sh);
    rect(buf, 6, 6, 11, 6, base);
    set(buf, 8, 6, skinBase);
    set(buf, 9, 6, skinBase);
    for (let y = 9; y <= 18; y++) {
      set(buf, L - 1, y, base);
      set(buf, R + 1, y, sh);
    }
    set(buf, L - 1, 19, base);
    set(buf, R + 1, 19, sh);
  }
  function hairBun(buf, hi, base, sh, skinBase) {
    rect(buf, L, 3, R, 5, base);
    rect(buf, L - 1, 4, R + 1, 5, base);
    rect(buf, 7, 1, 10, 2, base);
    set(buf, 8, 0, hi);
    set(buf, 9, 0, base);
    rect(buf, 6, 6, 11, 6, base);
    set(buf, 8, 6, skinBase);
    set(buf, 9, 6, skinBase);
    for (let y = 6; y <= 8; y++) {
      set(buf, L, y, base);
      set(buf, R, y, sh);
    }
    for (let x = L; x <= R; x++) if (alpha(buf, x, 3)) set(buf, x, 3, hi);
  }
  function hairCurly(buf, hi, base, sh, skinBase) {
    rect(buf, L, 3, R, 5, base);
    const pts = [
      [4, 2], [5, 1], [6, 2], [7, 1], [8, 2], [9, 1], [10, 2], [11, 1], [12, 2], [13, 2],
      [3, 3], [3, 4], [3, 5], [3, 6], [14, 3], [14, 4], [14, 5], [14, 6], [4, 6], [13, 6],
    ];
    dots(buf, pts, base);
    rect(buf, 6, 6, 11, 6, base);
    set(buf, 8, 6, skinBase);
    set(buf, 9, 6, skinBase);
    dots(buf, [[5, 1], [7, 1], [9, 1], [11, 1]], hi);
    set(buf, R + 1, 5, sh);
  }
  function hairSpiky(buf, hi, base, sh, skinBase) {
    rect(buf, L, 3, R, 5, base);
    rect(buf, L - 1, 4, R + 1, 5, base);
    dots(buf, [[5, 2], [6, 1], [7, 2], [8, 1], [9, 2], [10, 1], [11, 2], [12, 1], [13, 2]], base);
    dots(buf, [[6, 1], [8, 1], [10, 1], [12, 1]], hi);
    rect(buf, 6, 6, 11, 6, base);
    set(buf, 8, 6, skinBase);
    set(buf, 9, 6, skinBase);
    for (let y = 6; y <= 7; y++) {
      set(buf, L, y, base);
      set(buf, R, y, sh);
    }
  }
  function hairBob(buf, hi, base, sh, skinBase) {
    hairShort(buf, hi, base, sh);
    rect(buf, 5, 6, 12, 6, base);
    set(buf, 8, 6, skinBase);
    set(buf, 9, 6, skinBase);
    for (let y = 7; y <= 12; y++) {
      set(buf, L - 1, y, base);
      set(buf, R + 1, y, sh);
    }
    set(buf, L - 1, 13, base);
    set(buf, R + 1, 13, sh);
  }
  function hairPony(buf, hi, base, sh) {
    hairShort(buf, hi, base, sh);
    rect(buf, 11, 0, 13, 2, base);
    set(buf, 12, 0, hi);
    set(buf, 13, 3, sh);
    set(buf, 14, 1, base);
    set(buf, 14, 2, sh);
  }

  const HAIR_FNS = [hairShort, hairFringe, hairLong, hairBun, hairCurly, hairSpiky, hairBob, hairPony];

  function drawFacial(buf, kind, color) {
    const [, base, sh] = shades(color);
    if (kind === 1) {
      for (const x of [6, 7, 8, 9, 10]) set(buf, x, 13, base);
      set(buf, 6, 12, base);
      set(buf, 10, 12, base);
    } else if (kind === 2) {
      dots(buf, [[5, 14], [6, 15], [7, 15], [8, 15], [9, 15], [10, 15], [11, 14], [12, 13], [4, 13]], sh);
    } else if (kind === 3) {
      rect(buf, 8, 14, 9, 15, base);
      rect(buf, 7, 13, 10, 13, base);
    }
  }

  function drawGlasses(buf) {
    const frame = [60, 54, 62];
    const glint = [236, 240, 246];
    for (const x of [5, 6]) {
      set(buf, x, 8, frame);
      set(buf, x, 10, frame);
    }
    set(buf, 4, 9, frame);
    set(buf, 7, 9, frame);
    for (const x of [10, 11]) {
      set(buf, x, 8, frame);
      set(buf, x, 10, frame);
    }
    set(buf, 9, 9, frame);
    set(buf, 12, 9, frame);
    set(buf, 8, 8, frame);
    set(buf, 3, 9, frame);
    set(buf, 13, 9, frame);
    set(buf, 4, 8, glint);
    set(buf, 9, 8, glint);
  }

  function drawBody(buf, cloth, c1, c2, skin) {
    const [hi, base, sh] = shades(c1);
    rect(buf, 4, 18, 13, 18, base);
    rect(buf, 3, 19, 14, 19, base);
    rect(buf, 4, 20, 13, 24, base);
    for (let y = 20; y <= 24; y++) {
      set(buf, 3, y, sh);
      set(buf, 14, y, sh);
      set(buf, 13, y, sh);
    }
    set(buf, 3, 24, skin.sh);
    set(buf, 14, 24, skin.sh);
    if (cloth === 0) {
      for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]]) set(buf, x, y, sh);
      rect(buf, 7, 18, 10, 19, skin.sh);
    } else if (cloth === 1) {
      const inner = c2 ? shades(c2)[1] : [235, 233, 226];
      for (let y = 18; y <= 24; y++) {
        set(buf, 8, y, inner);
        set(buf, 9, y, inner);
      }
      for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]]) set(buf, x, y, sh);
    } else if (cloth === 2) {
      for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]]) set(buf, x, y, hi);
      set(buf, 8, 19, sh);
      set(buf, 8, 21, sh);
    } else if (cloth === 3) {
      for (const x of [6, 7, 8, 9, 10, 11]) set(buf, x, 18, sh);
    } else if (cloth === 4) {
      const inner = c2 ? shades(c2)[1] : [238, 236, 228];
      rect(buf, 7, 18, 10, 19, inner);
      for (const [x, y] of [[6, 18], [7, 19], [11, 18], [10, 19]]) set(buf, x, y, sh);
      for (let y = 20; y <= 24; y += 2) set(buf, 8, y, sh);
    } else {
      const apron = [236, 224, 196];
      rect(buf, 7, 20, 10, 24, apron);
      set(buf, 8, 19, apron);
      set(buf, 9, 19, apron);
      for (const [x, y] of [[6, 18], [7, 18], [10, 18], [11, 18]]) set(buf, x, y, hi);
    }
  }

  function drawLegs(buf, pants, shoe, short) {
    const top = short ? 26 : 25;
    const foot = short ? 30 : 31;
    const [, base, sh] = shades(pants);
    rect(buf, 5, top, 7, foot - 1, base);
    rect(buf, 10, top, 12, foot - 1, base);
    for (let y = top; y <= foot - 1; y++) {
      set(buf, 7, y, sh);
      set(buf, 12, y, sh);
    }
    rect(buf, 5, foot, 7, foot, shoe);
    rect(buf, 10, foot, 12, foot, shoe);
  }

  function elfEars(buf, s) {
    dots(buf, [[2, 8], [2, 7], [3, 7], [3, 8]], s.base);
    set(buf, 2, 7, s.hi);
    dots(buf, [[15, 8], [15, 7], [14, 7], [14, 8]], s.base);
    set(buf, 15, 7, s.hi);
  }

  function demiEars(buf, s) {
    set(buf, 3, 8, s.base);
    set(buf, 2, 9, s.sh);
    set(buf, 14, 8, s.base);
    set(buf, 15, 9, s.sh);
  }

  function dwarfStout(buf, clothRgb, skin) {
    const sh = shades(clothRgb)[2];
    for (let y = 19; y <= 24; y++) {
      set(buf, 2, y, sh);
      set(buf, 15, y, sh);
    }
    for (const x of [5, 6, 10, 11]) set(buf, x, 7, skin.line);
  }

  function outlinePass(buf) {
    const pts = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (alpha(buf, x, y) !== 0) continue;
        if (
          alpha(buf, x + 1, y) === 255 ||
          alpha(buf, x - 1, y) === 255 ||
          alpha(buf, x, y + 1) === 255 ||
          alpha(buf, x, y - 1) === 255
        ) {
          pts.push([x, y]);
        }
      }
    }
    for (const [x, y] of pts) set(buf, x, y, OUT);
  }

  function fnv(key) {
    let n = 2166136261;
    const s = String(key || "");
    for (let i = 0; i < s.length; i++) {
      n ^= s.charCodeAt(i);
      n = Math.imul(n, 16777619);
    }
    return n >>> 0;
  }

  function buddyPixels(shirt, seed) {
    const n = typeof seed === "string" ? fnv(seed) : seed >>> 0;
    const buf = new Uint8ClampedArray(W * H * 4);
    const race = (n >>> 20) % 4;
    const skin = SKIN[n % SKIN.length];
    const hairc = HAIR_RGB[(n * 3) % HAIR_RGB.length];
    const [hi, base, sh] = shades(hairc);
    const cloth = n % 6;
    const pants = PANTS[(n * 5) % PANTS.length];
    const shoe = SHOE[n % SHOE.length];
    const shirtRgb = parseHex(shirt);
    const accent = shades(shirtRgb)[2];
    const brow = race === 1 ? 0 : (n * 7) % 4;
    const mouth = [1, 3, 0, 1][n % 4];
    const lashes = cloth === 1 || cloth === 5 || (n % 5 === 2);
    const blush = lashes && n % 3 !== 0;
    const glasses = n % 19 === 0;
    const facial = 0;
    drawBody(buf, cloth, shirtRgb, accent, skin);
    drawLegs(buf, pants, shoe, race === 1);
    drawHead(buf, skin);
    drawFace(buf, skin, brow, mouth, blush, lashes);
    if (facial) drawFacial(buf, facial, hairc);
    HAIR_FNS[n % HAIR_FNS.length](buf, hi, base, sh, skin.base);
    if (glasses) drawGlasses(buf);
    if (race === 1) dwarfStout(buf, shirtRgb, skin);
    if (race === 2) elfEars(buf, skin);
    if (race === 3) demiEars(buf, skin);
    outlinePass(buf);
    return buf;
  }

  function drawBuddy(canvas, shirt, seed) {
    const ctx = canvas.getContext("2d");
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(W, H);
    img.data.set(buddyPixels(shirt, seed));
    ctx.putImageData(img, 0, 0);
  }

  root.BUDDY_W = W;
  root.BUDDY_H = H;
  root.buddyFnv = fnv;
  root.buddyPixels = buddyPixels;
  root.drawBuddy = drawBuddy;
})(typeof globalThis !== "undefined" ? globalThis : this);
