'use strict';
/* Cut-shape geometry: smoothing, path building, mask rendering and cutting.
   A "cut" is { ops: [op...], smooth: 0-100, feather: 0-100 } in SOURCE-PHOTO pixel coordinates.
   An op is { type: 'lasso'|'polygon'|'rect'|'ellipse', mode: 'add'|'sub', points?: [[x,y]...], x?, y?, w?, h? }.
   Ops are treated as immutable: edits create new op objects, which keeps memoisation and undo simple. */
(function (CC) {
  const U = CC.util;
  const G = (CC.geo = {});

  G.featherPx = (feather, diag) => (feather / 100) * diag * 0.015;
  G.smoothPx = (smooth, diag) => (smooth / 100) * diag * 0.012;

  /* Ramer–Douglas–Peucker simplification (open polyline). */
  G.simplify = (pts, eps) => {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-9;
      let maxD = -1, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };

  /* Evenly resample a closed polygon. */
  G.resampleClosed = (pts, spacing) => {
    let perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    spacing = Math.max(spacing, perim / 6000);
    const out = [[pts[0][0], pts[0][1]]];
    let need = spacing;
    for (let i = 0; i < pts.length; i++) {
      let ax = pts[i][0], ay = pts[i][1];
      const bx = pts[(i + 1) % pts.length][0], by = pts[(i + 1) % pts.length][1];
      let seg = Math.hypot(bx - ax, by - ay);
      while (seg >= need && seg > 0) {
        const t = need / seg;
        ax += (bx - ax) * t;
        ay += (by - ay) * t;
        out.push([ax, ay]);
        seg -= need;
        need = spacing;
      }
      need -= seg;
    }
    if (out.length > 3) {
      const l = out[out.length - 1];
      if (Math.hypot(l[0] - out[0][0], l[1] - out[0][1]) < spacing * 0.5) out.pop();
    }
    return out;
  };

  /* Circular moving average. */
  G.smoothClosed = (pts, r) => {
    const n = pts.length;
    r = Math.min(r, Math.floor((n - 1) / 2));
    if (r < 1) return pts;
    const out = new Array(n);
    const w = 2 * r + 1;
    let sx = 0, sy = 0;
    for (let k = -r; k <= r; k++) {
      const p = pts[(k + n) % n];
      sx += p[0];
      sy += p[1];
    }
    for (let i = 0; i < n; i++) {
      out[i] = [sx / w, sy / w];
      const add = pts[(i + r + 1) % n], rem = pts[(i - r + n) % n];
      sx += add[0] - rem[0];
      sy += add[1] - rem[1];
    }
    return out;
  };

  G.opBounds = (op) => {
    if (op.type === 'rect' || op.type === 'ellipse') return { x: op.x, y: op.y, w: op.w, h: op.h };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of op.points) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  const memo = new WeakMap();
  /* Path2D for an op in source coordinates, with smoothing applied. */
  G.opPath = (op, smooth, diag) => {
    const m = memo.get(op);
    if (m && m.smooth === smooth && m.diag === diag) return m.path;
    const path = new Path2D();
    if (op.type === 'rect') {
      const r = Math.min(op.w, op.h) / 2 * (smooth / 100);
      const { x, y, w, h } = op;
      if (r > 0.5) {
        path.moveTo(x + r, y);
        path.arcTo(x + w, y, x + w, y + h, r);
        path.arcTo(x + w, y + h, x, y + h, r);
        path.arcTo(x, y + h, x, y, r);
        path.arcTo(x, y, x + w, y, r);
        path.closePath();
      } else {
        path.rect(x, y, w, h);
      }
    } else if (op.type === 'ellipse') {
      path.ellipse(op.x + op.w / 2, op.y + op.h / 2, Math.max(0.5, op.w / 2), Math.max(0.5, op.h / 2), 0, 0, Math.PI * 2);
    } else {
      let pts = op.points;
      if (smooth > 0 && pts.length >= 3) {
        const spacing = Math.max(1, diag / 1200);
        pts = G.resampleClosed(pts, spacing);
        const r = Math.round(G.smoothPx(smooth, diag) / spacing);
        pts = G.smoothClosed(pts, r);
      }
      pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      path.closePath();
    }
    memo.set(op, { smooth, diag, path });
    return path;
  };

  /* Paint a mask (opaque = keep) for the ops into ctx, whose transform maps source coords. */
  G.renderMask = (ctx, ops, smooth, diag) => {
    ctx.fillStyle = '#000';
    for (const op of ops) {
      ctx.globalCompositeOperation = op.mode === 'sub' ? 'destination-out' : 'source-over';
      ctx.fill(G.opPath(op, smooth, diag), 'nonzero');
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  /* Integer bounding box of what the cut keeps, clamped to the photo. */
  G.cutBounds = (cut, imgW, imgH) => {
    const adds = cut.ops.filter((o) => o.mode !== 'sub');
    if (!adds.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const op of adds) {
      const b = G.opBounds(op);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    const pad = G.featherPx(cut.feather || 0, Math.hypot(imgW, imgH)) * 2;
    x0 = Math.max(0, Math.floor(x0 - pad));
    y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(imgW, Math.ceil(x1 + pad));
    y1 = Math.min(imgH, Math.ceil(y1 + pad));
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  /* Cut the photo: returns { canvas, box } at full source resolution, or null if nothing is selected. */
  G.renderCut = (img, cut) => {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const diag = Math.hypot(W, H);
    const box = G.cutBounds(cut, W, H);
    if (!box) return null;
    const mask = U.canvas(box.w, box.h);
    const mctx = mask.getContext('2d');
    mctx.translate(-box.x, -box.y);
    G.renderMask(mctx, cut.ops, cut.smooth || 0, diag);

    const out = U.canvas(box.w, box.h);
    const octx = out.getContext('2d');
    const f = G.featherPx(cut.feather || 0, diag);
    if (f > 0.3) octx.filter = `blur(${f.toFixed(2)}px)`;
    octx.drawImage(mask, 0, 0);
    octx.filter = 'none';
    octx.globalCompositeOperation = 'source-in';
    octx.drawImage(img, -box.x, -box.y);
    octx.globalCompositeOperation = 'source-over';
    return { canvas: out, box };
  };

  /* Halving image pyramid so big cut-outs draw crisp (and fast) at any zoom. */
  G.buildMips = (canvas) => {
    const levels = [canvas];
    let c = canvas;
    while (Math.max(c.width, c.height) > 96) {
      const n = U.canvas(Math.ceil(c.width / 2), Math.ceil(c.height / 2));
      const x = n.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(c, 0, 0, n.width, n.height);
      levels.push(n);
      c = n;
    }
    return levels;
  };

  const scratch = document.createElement('canvas').getContext('2d');
  G.pointInOp = (op, x, y, smooth, diag) => scratch.isPointInPath(G.opPath(op, smooth, diag), x, y);

  G.roundPts = (pts) => pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);

  /* ---------- Mask → shapes (for AI results) ---------- */

  /* 4-connected component labelling of pixels where on(i) is true. */
  function labelComponents(w, h, on) {
    const lab = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    for (let i = 0; i < w * h; i++) {
      if (lab[i] || !on(i)) continue;
      const id = comps.length + 1;
      let sp = 0, area = 0, border = false;
      stack[sp++] = i;
      lab[i] = id;
      while (sp) {
        const p = stack[--sp];
        area++;
        const x = p % w, y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        if (x > 0 && !lab[p - 1] && on(p - 1)) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && on(p + 1)) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && !lab[p - w] && on(p - w)) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && !lab[p + w] && on(p + w)) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      comps.push({ id, area, start: i, border }); // start = first pixel in row-major order
    }
    return { lab, comps };
  }

  /* Marching-squares outline of one region (after d3's contour tracer); vertices at pixel corners. */
  const DX = [1, 0, 1, 1, -1, 0, -1, 1, 0, 0, 0, 0, -1, 0, -1, NaN];
  const DY = [0, -1, 0, 0, 0, -1, 0, 0, 1, -1, 1, 1, 0, -1, 0, NaN];
  function traceOutline(w, h, inside, start) {
    const sx = start % w, sy = (start - sx) / w;
    let x = sx, y = sy, pdx = NaN, pdy = NaN, guard = 0;
    const pts = [];
    const limit = 8 * w * h + 16;
    do {
      let i = 0;
      if (inside(x - 1, y - 1)) i += 1;
      if (inside(x, y - 1)) i += 2;
      if (inside(x - 1, y)) i += 4;
      if (inside(x, y)) i += 8;
      let dx, dy;
      if (i === 6) { dx = pdy === -1 ? -1 : 1; dy = 0; }
      else if (i === 9) { dx = 0; dy = pdx === 1 ? -1 : 1; }
      else { dx = DX[i]; dy = DY[i]; }
      if (Number.isNaN(dx)) break;
      if (dx !== pdx && dy !== pdy) { pts.push([x, y]); pdx = dx; pdy = dy; }
      x += dx;
      y += dy;
    } while ((x !== sx || y !== sy) && ++guard < limit);
    return pts;
  }

  /* Turn a binary mask (w×h bytes, non-zero = object) into lasso shapes in photo coordinates
     (scaled by k): one 'add' outline per sizeable piece, plus 'sub' outlines for real holes. */
  G.maskToOps = (mask, w, h, k) => {
    const N = w * h;
    const fg = labelComponents(w, h, (i) => mask[i] !== 0);
    if (!fg.comps.length) return [];
    const largest = Math.max(...fg.comps.map((c) => c.area));
    const keep = fg.comps
      .filter((c) => c.area >= Math.max(16, largest * 0.02, N * 0.0002))
      .sort((a, b) => b.area - a.area)
      .slice(0, 12);
    const bg = labelComponents(w, h, (i) => mask[i] === 0);
    const holes = bg.comps.filter((c) => !c.border && c.area >= Math.max(16, largest * 0.004));

    const toOp = (pts, mode) => {
      if (pts.length < 3) return null;
      let p = G.resampleClosed(pts, 1);
      p = G.smoothClosed(p, 2); // soften the pixel staircase
      p = G.simplify(p, 0.45);
      if (p.length < 3) return null;
      return { type: 'lasso', mode, points: G.roundPts(p.map(([x, y]) => [x * k, y * k])) };
    };
    const ops = [];
    for (const c of keep) {
      const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && fg.lab[y * w + x] === c.id;
      const op = toOp(traceOutline(w, h, inside, c.start), 'add');
      if (op) ops.push(op);
    }
    for (const c of holes) {
      const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && bg.lab[y * w + x] === c.id;
      const op = toOp(traceOutline(w, h, inside, c.start), 'sub');
      if (op) ops.push(op);
    }
    return ops;
  };

  /* ---------- Sticker border ---------- */
  const colorCtx = document.createElement('canvas').getContext('2d');
  const toRGB = (c) => {
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = c;
    const hex = colorCtx.fillStyle;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  };

  /* Die-cut sticker: grow the piece's silhouette by r pixels in a solid colour and put the piece on top.
     The growing is done on a reduced-size copy (fast even for big cut-outs), then scaled back up,
     which also gives the border a clean anti-aliased edge. Returns { canvas, pad }. */
  G.renderSticker = (src, r, color) => {
    const pad = Math.ceil(r) + 2;
    const W = src.width + pad * 2, H = src.height + pad * 2;
    const q = Math.min(1, 1400 / Math.max(W, H));
    const sw = Math.max(1, Math.round(src.width * q)), sh = Math.max(1, Math.round(src.height * q));

    // solid silhouette (alpha thresholded so soft/feathered edges still get a crisp border)
    const sil = U.canvas(sw, sh);
    const sx = sil.getContext('2d', { willReadFrequently: true });
    sx.drawImage(src, 0, 0, sw, sh);
    const id = sx.getImageData(0, 0, sw, sh);
    const d = id.data;
    const [cr, cg, cb] = toRGB(color);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb;
      d[i + 3] = d[i + 3] >= 64 ? 255 : 0;
    }
    sx.putImageData(id, 0, 0);

    // dilate: stamp the silhouette around concentric circles
    const rw = Math.round(W * q), rh = Math.round(H * q), rq = r * q, pq = pad * q;
    const ring = U.canvas(rw, rh);
    const rx = ring.getContext('2d');
    const radii = rq > 3 ? [rq, rq * 0.66, rq * 0.33] : [rq];
    for (const rr of radii) {
      const steps = Math.min(96, Math.max(12, Math.ceil((2 * Math.PI * rr) / Math.max(0.8, rq * 0.14))));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        rx.drawImage(sil, pq + rr * Math.cos(a), pq + rr * Math.sin(a));
      }
    }
    rx.drawImage(sil, pq, pq);

    const out = U.canvas(W, H);
    const ox = out.getContext('2d');
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(ring, 0, 0, W, H);
    ox.drawImage(src, pad, pad);
    return { canvas: out, pad };
  };
})(window.CC);
