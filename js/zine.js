'use strict';
/* Zine mode: an 8-page mini zine folded from one sheet, plus an optional poster on the back of the sheet.

   You edit six "surfaces": the front cover, the spreads 2–3 / 4–5 / 6–7 (each one wide canvas, because
   those pages sit side by side on the printed sheet), the back cover and the poster. Only the current
   surface lives on the board; the others are kept as saved states. Each surface keeps its own undo history.

   Printed side (landscape sheet, 4 × 2 cells). The top row is upside down so it reads correctly once folded:
       top:    5  4  3  2   (rotated 180°)
       bottom: 6  7  8  1   (8 = back cover, 1 = front cover)
   The back of the sheet ends up entirely inside the folded zine, so the poster only shows when unfolded
   (and it doesn't matter which way the printer flips the sheet). */
(function (CC) {
  const U = CC.util;
  const B = CC.board;
  const MM = 96 / 25.4;
  const Z = (CC.zine = { active: false, data: null, stash: null, hist: {}, view: 'pages', FORMAT: 'collage-cutter-zine' });

  // Illustrated folding guide by 42nd Street (linked to, not copied, since it's their artwork).
  Z.FOLD_GUIDE_URL = 'https://www.42ndstreet.org.uk/media/etdlxppk/zine-guide-colour.jpg';

  Z.SHEETS = [
    { id: 'a4', label: 'A4', w: 297, h: 210, unit: 'mm' },
    { id: 'letter', label: 'US Letter', w: 11, h: 8.5, unit: 'in' },
    { id: 'a3', label: 'A3', w: 420, h: 297, unit: 'mm' },
    { id: 'custom', label: 'Custom…' },
  ];

  Z.SURFACES = [
    { id: 'cover', label: 'Front cover', short: 'Cover', pages: [1], about: 'The front of the folded zine.' },
    { id: 's23', label: 'Pages 2–3', short: '2–3', pages: [2, 3], about: 'The first spread inside. Pieces can run across the fold.' },
    { id: 's45', label: 'Pages 4–5', short: '4–5', pages: [4, 5], about: 'The middle spread. Pieces can run across the fold.' },
    { id: 's67', label: 'Pages 6–7', short: '6–7', pages: [6, 7], about: 'The last spread. Pieces can run across the fold.' },
    { id: 'back', label: 'Back cover', short: 'Back', pages: [8], about: 'The back of the folded zine.' },
    { id: 'poster', label: 'Poster', short: 'Poster', pages: [0], about: 'Prints on the back of the sheet, so it only shows when the zine is unfolded. Print double-sided.' },
  ];
  const surf = (id) => Z.SURFACES.find((s) => s.id === id);

  // [column from the left, row (0 = top)] of each page on the printed side
  Z.CELLS = { 1: [3, 1], 2: [3, 0], 3: [2, 0], 4: [1, 0], 5: [0, 0], 6: [0, 1], 7: [1, 1], 8: [2, 1] };
  Z.pageName = (n) => (n === 1 ? 'Front cover' : n === 8 ? 'Back cover' : n === 0 ? 'Poster' : `Page ${n}`);
  const surfaceOfPage = (n) => Z.SURFACES.find((s) => s.pages.includes(n));

  /* Which edges of a page are edges of the sheet (where a home printer can't print). The page's top
     edge is always the middle fold. */
  function sheetEdges(n) {
    if (n === 0) return { l: true, r: true, t: true, b: true };
    const [c, r] = Z.CELLS[n];
    const L = c === 0, R = c === 3;
    return r === 0 ? { l: R, r: L, t: false, b: true } : { l: L, r: R, t: false, b: true };
  }

  /* ---------- Data ---------- */
  const sheetFromPreset = (id) => {
    const p = Z.SHEETS.find((x) => x.id === id) || Z.SHEETS[0];
    return { preset: p.id, unit: p.unit, w: U.round(B.toPx(p.w, p.unit), 3), h: U.round(B.toPx(p.h, p.unit), 3) };
  };

  function surfacePaper(d, id, prev) {
    const s = surf(id), sh = d.sheet;
    const pw = sh.w / 4, ph = sh.h / 2;
    let w, h;
    if (id === 'poster') [w, h] = d.posterOrient === 'portrait' ? [sh.h, sh.w] : [sh.w, sh.h];
    else [w, h] = [pw * s.pages.length, ph];
    const color = (prev && prev.color) || '#ffffff';
    const pages = s.pages.map((num, i) => ({
      num,
      x: U.round(id === 'poster' ? 0 : i * pw, 3),
      y: 0,
      w: U.round(id === 'poster' ? w : pw, 3),
      h: U.round(h, 3),
      color: (prev && prev.pages && prev.pages[i] && prev.pages[i].color) || color,
    }));
    return { preset: 'zine', unit: sh.unit === 'in' ? 'in' : 'mm', orient: w > h ? 'landscape' : 'portrait', w: U.round(w, 3), h: U.round(h, 3), color, pages, surface: id };
  }

  Z.defaultData = (base) => {
    const d = {
      version: 1,
      sheet: base ? { ...base.sheet } : sheetFromPreset('a4'),
      opts: base ? { ...base.opts } : { numbers: false, safe: true, safeMm: 5 },
      posterOrient: base ? base.posterOrient : 'landscape',
      current: 'cover',
      surfaces: {},
    };
    for (const s of Z.SURFACES) d.surfaces[s.id] = { paper: surfacePaper(d, s.id), objects: [] };
    return d;
  };

  Z.load = (data) => {
    const d = Z.defaultData();
    if (data && data.sheet && data.sheet.w > 0 && data.sheet.h > 0) d.sheet = { ...d.sheet, ...data.sheet };
    if (data && data.opts) d.opts = { ...d.opts, ...data.opts };
    if (data && data.posterOrient === 'portrait') d.posterOrient = 'portrait';
    if (data && surf(data.current)) d.current = data.current;
    for (const s of Z.SURFACES) {
      const src = data && data.surfaces && data.surfaces[s.id];
      d.surfaces[s.id] = { paper: surfacePaper(d, s.id, src && src.paper), objects: (src && src.objects) || [] };
    }
    Z.data = d;
    Z.hist = {};
  };

  /* The live state of a surface (the current one is on the board). */
  Z.stateOf = (id) => (Z.active && id === Z.data.current ? B.getState() : Z.data.surfaces[id]);
  Z.hasWork = () => !!Z.data && Z.SURFACES.some((s) => (Z.stateOf(s.id).objects || []).length);
  Z.serialize = () => {
    const d = JSON.parse(JSON.stringify(Z.data));
    if (Z.active) d.surfaces[d.current] = B.getState();
    return d;
  };
  Z.snapshot = () => {
    const data = Z.serialize();
    return { data, cuts: CC.io.cutsFor(Object.values(data.surfaces).map((s) => s.objects)) };
  };
  Z.usedCutIds = () => {
    const ids = new Set();
    if (!Z.active) return ids;
    for (const s of Object.values(Z.data.surfaces)) for (const o of s.objects || []) if (o.kind === 'cut') ids.add(o.cutId);
    return ids;
  };

  function storeCurrent() {
    if (!Z.active) return;
    B.exitEditing();
    const cur = Z.data.current;
    Z.data.surfaces[cur] = B.getState();
    Z.hist[cur] = B.getHistory();
  }

  function showSurface(id, hist) {
    const st = Z.data.surfaces[id];
    B.restore({ paper: surfacePaper(Z.data, id, st.paper), objects: st.objects }, { keepSelection: false });
    B.setHistory(hist);
    B.fit();
    renderStrip();
  }

  /* ---------- Switching modes and surfaces ---------- */
  Z.enter = ({ silent = false } = {}) => {
    if (Z.active) return;
    B.exitEditing();
    if (!Z.data) Z.data = Z.defaultData();
    Z.stash = { state: B.getState(), hist: B.getHistory() };
    Z.active = true;
    syncModeUI();
    showSurface(Z.data.current, Z.hist[Z.data.current]);
    renderAllThumbs();
    if (!silent) CC.io.saveNow();
  };

  Z.exit = () => {
    if (!Z.active) return;
    storeCurrent();
    Z.active = false;
    setView('pages');
    syncModeUI();
    B.restore(Z.stash.state, { keepSelection: false });
    B.setHistory(Z.stash.hist);
    Z.stash = null;
    B.fit();
    CC.io.saveNow();
  };

  Z.go = (id) => {
    if (!Z.active || !surf(id)) return;
    if (id !== Z.data.current) {
      storeCurrent();
      renderThumb(Z.data.current);
      Z.data.current = id;
      showSurface(id, Z.hist[id]);
      CC.io.scheduleAutosave();
    }
    setView('pages');
  };
  Z.step = (d) => {
    const i = Z.SURFACES.findIndex((s) => s.id === Z.data.current);
    Z.go(Z.SURFACES[U.clamp(i + d, 0, Z.SURFACES.length - 1)].id);
  };

  Z.newZine = async () => {
    if (Z.hasWork()) {
      const ok = await U.confirm({ title: 'Start a new zine?', message: 'This clears all 8 pages and the poster. Your photos stay in the tray. (Save the zine first if you want to keep it.)', ok: 'Clear zine', danger: true });
      if (!ok) return;
    }
    B.exitEditing();
    Z.data = Z.defaultData(Z.data);
    Z.hist = {};
    showSurface('cover');
    renderAllThumbs();
    CC.sources.gc(CC.app.referencedSources());
    CC.sources.renderTray();
    CC.io.saveNow();
  };

  /* ---------- Sheet size & poster orientation ---------- */
  // Keep content where it was relative to the page; `fit` decides how pieces are resized.
  function rescaleSurface(id, fit = 'max') {
    const st = Z.data.surfaces[id];
    const np = surfacePaper(Z.data, id, st.paper);
    const sx = np.w / st.paper.w, sy = np.h / st.paper.h;
    const k = fit === 'min' ? Math.min(sx, sy) : Math.max(sx, sy);
    if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) {
      st.objects = st.objects.map((d) => ({ ...d, left: d.left * sx, top: d.top * sy, scaleX: d.scaleX * k, scaleY: d.scaleY * k }));
    }
    st.paper = np;
  }

  Z.setSheet = (sheet) => {
    storeCurrent();
    Z.data.sheet = { ...Z.data.sheet, ...sheet };
    for (const s of Z.SURFACES) rescaleSurface(s.id);
    Z.hist = {}; // sizes changed underneath every page's undo history
    showSurface(Z.data.current);
    renderAllThumbs();
    CC.io.saveNow();
  };

  Z.setPosterOrient = (o) => {
    if (o === Z.data.posterOrient) return;
    storeCurrent();
    Z.data.posterOrient = o;
    rescaleSurface('poster', 'min');
    delete Z.hist.poster;
    if (Z.data.current === 'poster') showSurface('poster');
    renderThumb('poster');
    CC.io.saveNow();
  };

  /* ---------- Board decoration: page numbers (printed) and guides (editor only) ---------- */
  function inkFor(color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if (!m) return '#1d1d1f';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum < 0.5 ? '#ffffff' : '#1d1d1f';
  }

  function drawNumbers(ctx, p) {
    const inset = (Math.max(Z.data.opts.safeMm || 0, 4) + 2) * MM;
    ctx.font = `${3.4 * MM}px "Courier Prime", "Courier New", monospace`;
    ctx.textBaseline = 'alphabetic';
    for (const pg of p.pages) {
      if (pg.num < 2 || pg.num > 7) continue;
      const left = pg.num % 2 === 0; // even pages are the left page of a spread
      ctx.fillStyle = inkFor(pg.color || p.color);
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(String(pg.num), left ? pg.x + inset : pg.x + pg.w - inset, pg.y + pg.h - inset);
    }
  }

  function drawGuides(ctx, v, p) {
    const z = v[0];
    ctx.lineWidth = 1 / z;
    // the fold down the middle of a spread
    if (p.pages.length > 1) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.beginPath();
      for (const pg of p.pages.slice(1)) { ctx.moveTo(pg.x, pg.y); ctx.lineTo(pg.x, pg.y + pg.h); }
      ctx.stroke();
    }
    // printer-safe margin along the sheet edges
    const o = Z.data.opts;
    if (o.safe && o.safeMm > 0) {
      const m = o.safeMm * MM;
      ctx.strokeStyle = 'rgba(228,87,46,0.7)';
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.beginPath();
      for (const pg of p.pages) {
        const e = sheetEdges(pg.num);
        const x0 = pg.x, y0 = pg.y, x1 = pg.x + pg.w, y1 = pg.y + pg.h;
        const top = e.t ? y0 + m : y0, bot = e.b ? y1 - m : y1, lft = e.l ? x0 + m : x0, rgt = e.r ? x1 - m : x1;
        if (e.l) { ctx.moveTo(lft, top); ctx.lineTo(lft, bot); }
        if (e.r) { ctx.moveTo(rgt, top); ctx.lineTo(rgt, bot); }
        if (e.b) { ctx.moveTo(lft, bot); ctx.lineTo(rgt, bot); }
        if (e.t) { ctx.moveTo(lft, top); ctx.lineTo(rgt, top); }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawLabels(ctx, v, p) {
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (const pg of p.pages) {
      const label = pg.num === 0 ? 'Poster · back of the sheet, shows when unfolded' : Z.pageName(pg.num);
      ctx.fillText(label, v[4] + (pg.x + pg.w / 2) * v[0], v[5] + pg.y * v[3] - 8);
    }
  }

  B.decorate = (ctx, v, p, { editor }) => {
    if (!p.surface || !p.pages || !Z.data) return;
    if (editor) {
      ctx.save();
      drawLabels(ctx, v, p);
      ctx.restore();
    }
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    if (Z.data.opts.numbers) drawNumbers(ctx, p);
    if (editor) drawGuides(ctx, v, p);
    ctx.restore();
  };

  /* ---------- Filling a page from a .collage file or a photo ---------- */
  const isSpread = () => B.paper.pages && B.paper.pages.length > 1;
  const isCollageFile = (f) => /\.collage$/i.test(f.name);
  const isImageFile = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);

  Z.fillPage = async (idx, file) => {
    const pg = B.paper.pages && B.paper.pages[idx];
    if (!Z.active || !pg) return;
    B.exitEditing();
    if (isCollageFile(file)) {
      const data = await CC.io.readProjectFile(file);
      if (!data) return;
      if (data.format === Z.FORMAT) return U.toast('That’s a whole zine. Use Open to load it.', 'warn', 4000);
      return importCollage(data, idx, file.name.replace(/\.collage$/i, ''));
    }
    let src;
    try {
      src = await CC.sources.importBlob(file, file.name);
    } catch (e) {
      return U.toast(`Couldn’t open ${file.name}`, 'error');
    }
    CC.sources.renderTray();
    const cut = CC.cuts.add({ sourceId: src.id, ops: [{ type: 'rect', mode: 'add', x: 0, y: 0, w: src.w, h: src.h }], smooth: 0, feather: 0 });
    const s = Math.max(pg.w / src.w, pg.h / src.h);
    const o = B.makeCutPiece(cut.id, { left: pg.x + pg.w / 2, top: pg.y + pg.h / 2, scaleX: s, scaleY: s, clip: isSpread() ? idx : undefined });
    if (!o) return;
    B.canvas.insertAt(o, 0); // behind anything already on the page
    B.select([o]);
    B.commit();
    U.toast(`Filled ${Z.pageName(pg.num).toLowerCase()} with “${src.name}”`, 'ok');
  };

  /* A collage arrives as its own editable pieces, scaled so its paper covers the page and
     trimmed to that page. The page takes on the collage's paper colour. */
  async function importCollage(data, idx, name) {
    const pg = B.paper.pages[idx];
    const st = data.state || {};
    const paper = { w: 793.701, h: 1122.52, color: '#ffffff', ...(st.paper || {}) };
    const bad = await CC.io.loadSources(data.sources, { replaceTray: false, hidden: true });
    CC.cuts.load(data.cuts);
    const s = Math.max(pg.w / paper.w, pg.h / paper.h);
    const ox = pg.x + pg.w / 2 - (paper.w / 2) * s, oy = pg.y + pg.h / 2 - (paper.h / 2) * s;
    const clip = isSpread() ? idx : undefined;
    const objs = [];
    let missing = bad;
    for (const d of st.objects || []) {
      const o = B.deserializeObj({ ...d, uid: U.uid('obj'), left: ox + d.left * s, top: oy + d.top * s, scaleX: d.scaleX * s, scaleY: d.scaleY * s, clip });
      if (o) objs.push(o);
      else missing++;
    }
    pg.color = paper.color;
    if (B.paper.pages.length === 1) B.paper.color = paper.color;
    const c = B.canvas;
    c.discardActiveObject();
    c.renderOnAddRemove = false;
    objs.forEach((o, i) => c.insertAt(o, i));
    c.renderOnAddRemove = true;
    objs.forEach(B.syncTextPadding);
    c.requestRenderAll();
    B.commit();
    CC.emit('selection');
    U.toast(`Filled ${Z.pageName(pg.num).toLowerCase()} with “${name}”` + (missing ? ` (${missing} piece(s) couldn’t be read)` : ''), missing ? 'warn' : 'ok', 3500);
  }

  /* Drop onto a page fills it. Returns true when the drop was handled here. */
  Z.handleDrop = (files, e) => {
    if (!Z.active) return false;
    const ws = U.$('#workspace');
    const r = ws.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const usable = files.filter((f) => isCollageFile(f) || isImageFile(f));
    let idx = -1;
    if (inside && Z.view === 'pages') {
      const v = B.canvas.viewportTransform;
      idx = B.pageIndexAt((e.clientX - r.left - v[4]) / v[0], (e.clientY - r.top - v[5]) / v[3]);
    }
    if (idx >= 0 && usable.length === 1) {
      Z.fillPage(idx, usable[0]);
      return true;
    }
    if (files.some(isCollageFile)) {
      U.toast('Drop one .collage file onto a page to fill that page', 'warn', 4000);
      return true;
    }
    return false;
  };

  /* ---------- Offscreen rendering: surfaces, the printed sheet, the poster side ---------- */
  const renderSurface = (id, scale) => B.renderState(Z.stateOf(id), scale);

  // The printed side at `scale` (canvas px per paper px).
  function composeFront(scale) {
    const sh = Z.data.sheet;
    const out = U.canvas(sh.w * scale, sh.h * scale);
    const W = out.width, H = out.height, pw = W / 4, ph = H / 2;
    const x = out.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    x.imageSmoothingQuality = 'high';
    x.drawImage(renderSurface('s67', scale), 0, ph, pw * 2, ph);
    x.drawImage(renderSurface('back', scale), pw * 2, ph, pw, ph);
    x.drawImage(renderSurface('cover', scale), pw * 3, ph, pw, ph);
    // top row: pages 2–5 as one strip, turned upside down
    x.save();
    x.translate(W, ph);
    x.rotate(Math.PI);
    x.drawImage(renderSurface('s23', scale), 0, 0, pw * 2, ph);
    x.drawImage(renderSurface('s45', scale), pw * 2, 0, pw * 2, ph);
    x.restore();
    return out;
  }

  // The back of the sheet: the poster, turned to fit the landscape sheet if it's portrait.
  function composeBack(scale) {
    const c = renderSurface('poster', scale);
    if (Z.data.posterOrient !== 'portrait') return c;
    const out = U.canvas(c.height, c.width);
    const x = out.getContext('2d');
    x.translate(out.width, 0);
    x.rotate(Math.PI / 2);
    x.drawImage(c, 0, 0);
    return out;
  }

  /* ---------- Page strip (thumbnails in reading order) ---------- */
  const THUMB_H = 54;
  function renderStrip() {
    const box = U.$('#zineThumbs');
    if (!Z.active) return;
    if (!box.children.length) {
      box.innerHTML = Z.SURFACES.map((s) => `${s.id === 'poster' ? '<span class="zsep" title="The other side of the sheet"></span>' : ''}
        <button class="zthumb" data-id="${s.id}" title="${U.esc(s.label)}${s.id === 'poster' ? ' (back of the sheet)' : ''}">
          <canvas></canvas><span>${U.esc(s.short)}</span>
        </button>`).join('');
    }
    U.$$('.zthumb', box).forEach((b) => b.classList.toggle('on', b.dataset.id === Z.data.current));
  }

  function renderThumb(id) {
    if (!Z.active) return;
    const btn = U.$(`.zthumb[data-id="${id}"]`);
    if (!btn) return;
    const st = Z.stateOf(id);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const src = B.renderState(st, (THUMB_H * dpr) / st.paper.h);
    const cv = btn.querySelector('canvas');
    cv.width = src.width;
    cv.height = src.height;
    cv.style.height = THUMB_H + 'px';
    cv.style.width = (THUMB_H * st.paper.w) / st.paper.h + 'px';
    cv.getContext('2d').drawImage(src, 0, 0);
  }
  function renderAllThumbs() {
    renderStrip();
    for (const s of Z.SURFACES) renderThumb(s.id);
  }

  const onChange = U.debounce(() => {
    if (!Z.active) return;
    renderThumb(Z.data.current);
    if (Z.view === 'sheet') renderSheetView();
  }, 250);

  /* ---------- Printed-sheet view ---------- */
  let sheetGeom = null;
  function setView(v) {
    Z.view = v;
    U.$('#zineSheet').hidden = v !== 'sheet';
    U.$$('#zineView [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    if (v === 'sheet') {
      storeCurrent();
      renderSheetView();
    }
  }
  Z.setView = setView;

  function renderSheetView() {
    const box = U.$('#zineSheet');
    const inner = U.$('.zsv-inner', box);
    const sh = Z.data.sheet;
    const asp = sh.h / sh.w;
    const W = box.clientWidth - 56, H = box.clientHeight - 150;
    const side = Math.min((W - 28) / 2, H / asp);
    const stacked = Math.min(W, (H - 40) / (2 * asp));
    const row = side >= stacked;
    const w = Math.max(120, Math.floor(row ? side : stacked));
    inner.classList.toggle('row', row);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (w * dpr) / sh.w;

    const front = U.$('#zsvFront');
    const f = composeFront(scale);
    front.width = f.width;
    front.height = f.height;
    front.style.width = w + 'px';
    const x = front.getContext('2d');
    x.drawImage(f, 0, 0);
    drawSheetMarks(x, f.width, f.height, dpr);

    const back = U.$('#zsvBack');
    const b = composeBack(scale);
    back.width = b.width;
    back.height = b.height;
    back.style.width = w + 'px';
    const bx = back.getContext('2d');
    bx.drawImage(b, 0, 0);
    bx.strokeStyle = 'rgba(0,0,0,0.25)';
    bx.lineWidth = dpr;
    bx.strokeRect(0, 0, b.width, b.height);
    if (Z.data.current === 'poster') highlight(bx, 0, 0, b.width, b.height, dpr);
    sheetGeom = { w };
  }

  function highlight(x, x0, y0, w, h, dpr) {
    x.save();
    x.strokeStyle = '#e4572e';
    x.lineWidth = 3 * dpr;
    x.strokeRect(x0 + 1.5 * dpr, y0 + 1.5 * dpr, w - 3 * dpr, h - 3 * dpr);
    x.restore();
  }

  // Folds (dashed), the single cut (red), page badges and the current page highlight
  function drawSheetMarks(x, W, H, dpr) {
    const pw = W / 4, ph = H / 2;
    x.save();
    x.strokeStyle = 'rgba(0,0,0,0.4)';
    x.lineWidth = dpr;
    x.setLineDash([5 * dpr, 4 * dpr]);
    x.beginPath();
    for (let c = 1; c < 4; c++) { x.moveTo(c * pw, 0); x.lineTo(c * pw, H); }
    x.moveTo(0, ph); x.lineTo(pw, ph);
    x.moveTo(3 * pw, ph); x.lineTo(W, ph);
    x.stroke();
    x.setLineDash([]);
    x.strokeStyle = '#d0312d';
    x.lineWidth = 2.5 * dpr;
    x.beginPath();
    x.moveTo(pw, ph); x.lineTo(3 * pw, ph);
    x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.25)';
    x.lineWidth = dpr;
    x.strokeRect(0, 0, W, H);
    // badges
    x.font = `700 ${11 * dpr}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (const [n, [c, r]] of Object.entries(Z.CELLS)) {
      const label = n === '1' ? 'Front' : n === '8' ? 'Back' : n;
      const cx = c * pw + pw / 2, cy = r * ph + ph / 2;
      const bw = Math.max(22 * dpr, x.measureText(label).width + 12 * dpr), bh = 20 * dpr;
      x.fillStyle = r === 0 ? 'rgba(42,38,34,0.72)' : 'rgba(228,87,46,0.9)';
      x.beginPath();
      x.roundRect ? x.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, bh / 2) : x.rect(cx - bw / 2, cy - bh / 2, bw, bh);
      x.fill();
      x.fillStyle = '#fff';
      x.fillText(label, cx, cy + 0.5 * dpr);
    }
    // current surface
    const cur = surf(Z.data.current);
    for (const n of cur.pages) if (Z.CELLS[n]) highlight(x, Z.CELLS[n][0] * pw, Z.CELLS[n][1] * ph, pw, ph, dpr);
    x.restore();
  }

  function sheetClick(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * 4), row = Math.floor(((e.clientY - r.top) / r.height) * 2);
    const n = +Object.keys(Z.CELLS).find((k) => Z.CELLS[k][0] === c && Z.CELLS[k][1] === row);
    const s = surfaceOfPage(n);
    if (s) Z.go(s.id);
  }
  function sheetHover(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * 4), row = Math.floor(((e.clientY - r.top) / r.height) * 2);
    const n = +Object.keys(Z.CELLS).find((k) => Z.CELLS[k][0] === c && Z.CELLS[k][1] === row);
    e.currentTarget.title = n ? `${Z.pageName(n)}${row === 0 ? ' (prints upside down)' : ''}: click to edit` : '';
  }

  /* ---------- Flip-through preview ---------- */
  let preview = null;
  Z.openPreview = () => {
    if (!Z.active) return;
    B.exitEditing();
    const sh = Z.data.sheet;
    const pw = sh.w / 4, ph = sh.h / 2;
    const dispH = Math.floor(Math.min(window.innerHeight * 0.7, 620, ((window.innerWidth * 0.9) / 2) * (ph / pw)));
    const dispW = Math.floor((dispH * pw) / ph);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (dispH * dpr) / ph;
    const pages = {};
    for (const s of Z.SURFACES) {
      if (s.id === 'poster') continue;
      const c = renderSurface(s.id, scale);
      const sw = c.width / s.pages.length;
      s.pages.forEach((n, i) => {
        const pc = U.canvas(sw, c.height);
        pc.getContext('2d').drawImage(c, i * sw, 0, sw, c.height, 0, 0, pc.width, pc.height);
        pages[n] = pc;
      });
    }
    const book = U.$('#zpBook');
    book.style.width = dispW * 2 + 'px';
    book.style.height = dispH + 'px';
    book.innerHTML = [0, 1, 2, 3].map((i) => `<div class="zp-leaf" data-i="${i}"><div class="zp-face front"></div><div class="zp-face back"></div></div>`).join('');
    U.$$('.zp-leaf', book).forEach((leaf, i) => {
      leaf.querySelector('.front').appendChild(pages[i * 2 + 1]);
      leaf.querySelector('.back').appendChild(pages[i * 2 + 2]);
    });
    preview = { k: 0, close: U.openModal(U.$('#zinePreview')) };
    setLeaves(0, true);
  };

  const PREVIEW_LABELS = ['Front cover', 'Pages 2–3', 'Pages 4–5', 'Pages 6–7', 'Back cover'];
  function setLeaves(k, instant) {
    if (!preview) return;
    const prev = preview.k;
    preview.k = U.clamp(k, 0, 4);
    const book = U.$('#zpBook');
    book.classList.toggle('instant', !!instant);
    U.$$('.zp-leaf', book).forEach((leaf, i) => {
      const flipped = i < preview.k;
      leaf.classList.toggle('flipped', flipped);
      // the leaf being turned goes on top while it moves
      const moving = (i === prev && preview.k > prev) || (i === preview.k && preview.k < prev);
      leaf.style.zIndex = moving ? 20 : flipped ? i + 1 : 10 - i;
    });
    book.style.transform = preview.k === 0 ? 'translateX(-25%)' : preview.k === 4 ? 'translateX(25%)' : 'none';
    U.$('#zpLabel').textContent = `${PREVIEW_LABELS[preview.k]}  ·  ${preview.k + 1} / 5`;
    U.$('#zpPrev').disabled = preview.k === 0;
    U.$('#zpNext').disabled = preview.k === 4;
  }

  function initPreview() {
    const dlg = U.$('#zinePreview');
    U.$('#zpPrev').onclick = () => setLeaves(preview.k - 1);
    U.$('#zpNext').onclick = () => setLeaves(preview.k + 1);
    U.$('#zpBook').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setLeaves(preview.k + (e.clientX > r.left + r.width / 2 ? 1 : -1));
    });
    document.addEventListener('keydown', (e) => {
      if (dlg.hidden || !preview) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setLeaves(preview.k + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setLeaves(preview.k - 1);
      else if (e.key === 'Escape') preview.close();
      else return;
      e.preventDefault();
    });
  }

  /* ---------- Export (2-page PDF: printed side + poster) ---------- */
  const zx = { dpi: 300 };
  const fmtMM = (px) => Math.round(px / MM);
  const fmtSize = (w, h) => (Z.data.sheet.unit === 'in' ? `${U.round(w / 96, 2)} × ${U.round(h / 96, 2)} in` : `${fmtMM(w)} × ${fmtMM(h)} mm`);
  const posterHasContent = () => {
    const st = Z.stateOf('poster');
    return st.objects.length > 0 || (st.paper.pages || []).some((p) => p.color && p.color.toLowerCase() !== '#ffffff') || st.paper.color.toLowerCase() !== '#ffffff';
  };

  function updateExportInfo() {
    const sh = Z.data.sheet;
    const poster = U.$('#zxPoster').checked;
    const px = (v) => Math.round(v * (zx.dpi / 96));
    U.$('#zxInfo').textContent = `${poster ? '2 pages' : '1 page'} · ${fmtSize(sh.w, sh.h)} landscape · ${px(sh.w)} × ${px(sh.h)} px · each zine page ${fmtSize(sh.w / 4, sh.h / 2)}`;
    U.$$('#zxDpi button').forEach((b) => b.classList.toggle('on', +b.dataset.v === zx.dpi));
  }

  let closeExport = null;
  Z.openExport = () => {
    storeCurrent();
    if (!Z.hasWork()) U.toast('The zine is empty, so the PDF will be blank pages', 'warn');
    U.$('#zxPoster').checked = posterHasContent();
    updateExportInfo();
    closeExport = U.openModal(U.$('#zineExportDlg'));
    U.$('#zxGo').focus();
  };

  async function doExport() {
    const btn = U.$('#zxGo');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    await new Promise((r) => setTimeout(r, 30));
    try {
      const scale = zx.dpi / 96;
      const sh = Z.data.sheet;
      const wmm = sh.w / MM, hmm = sh.h / MM;
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [wmm, hmm], compress: true });
      doc.addImage(composeFront(scale).toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wmm, hmm, undefined, 'NONE');
      if (U.$('#zxPoster').checked) {
        doc.addPage([wmm, hmm], 'landscape');
        doc.addImage(CC.io.flatten(composeBack(scale)).toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wmm, hmm, undefined, 'NONE');
      }
      doc.save(`zine_${U.stamp()}.pdf`);
      closeExport && closeExport();
      U.toast('Exported PDF', 'ok');
    } catch (e) {
      console.error(e);
      U.toast('Export failed: ' + e.message, 'error', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export PDF';
    }
  }

  /* ---------- Files ---------- */
  Z.saveFile = async () => {
    B.exitEditing();
    const snap = Z.snapshot();
    const sources = await CC.io.sourcesFor(snap.cuts);
    const file = { format: Z.FORMAT, version: 1, savedAt: new Date().toISOString(), zine: snap.data, cuts: snap.cuts, sources };
    U.download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `zine_${U.stamp()}.zine`);
    U.toast('Zine saved to your downloads');
  };

  Z.openData = async (data) => {
    if (Z.hasWork()) {
      const ok = await U.confirm({ title: 'Open zine?', message: 'This replaces the zine you have now (save it first if you want to keep it). Your single collage isn’t affected.', ok: 'Open' });
      if (!ok) return;
    }
    if (!Z.active) Z.enter({ silent: true });
    const bad = await CC.io.loadSources(data.sources);
    CC.cuts.load(data.cuts);
    Z.load(data.zine);
    showSurface(Z.data.current);
    renderAllThumbs();
    setView('pages');
    CC.sources.gc(CC.app.referencedSources());
    CC.sources.renderTray();
    CC.io.saveNow();
    U.toast(bad ? `Opened, but ${bad} photo(s) couldn’t be read` : 'Zine opened', bad ? 'warn' : 'ok');
  };

  /* ---------- Side panel (shown when nothing is selected) ---------- */
  Z.panelHTML = () => {
    const P = CC.panels;
    const s = surf(Z.data.current);
    const p = B.paper;
    if (!p.pages) return ''; // mid-switch: the zine page isn't on the board yet
    const sh = Z.data.sheet;
    const unit = sh.unit === 'in' ? 'in' : 'mm';
    const fmt = (v) => +B.fromPx(v, unit).toFixed(unit === 'in' ? 2 : 1);
    const colours = (p.pages || []).map((pg, i) => `
      <div class="row color-row"><span class="lbl">${p.pages.length > 1 ? `Page ${pg.num}` : 'Colour'}</span><input type="color" id="zPC${i}" value="${P.toHex(pg.color || p.color)}">${P.swatches(P.PAPERS, 'zPC' + i)}</div>`).join('');
    const fills = (p.pages || []).map((pg, i) => `<button class="pbtn" data-zfill="${i}" data-icon="imagePlus" title="Choose a .collage file or a photo to fill ${Z.pageName(pg.num).toLowerCase()}">Fill ${p.pages.length > 1 ? 'page ' + pg.num : s.id === 'poster' ? 'poster' : 'page'}…</button>`).join('');
    return `
      <div class="psec">
        <h3>${U.icon('book')} ${U.esc(s.label)}</h3>
        <p class="sub">${U.esc(s.about)}</p>
        ${s.id === 'poster' ? `<div class="row"><span class="lbl">Shape</span><div class="seg" id="zOrient">
            <button data-v="landscape" class="${Z.data.posterOrient !== 'portrait' ? 'on' : ''}" title="Landscape">${U.icon('landscape')}</button>
            <button data-v="portrait" class="${Z.data.posterOrient === 'portrait' ? 'on' : ''}" title="Portrait">${U.icon('portrait')}</button></div></div>` : ''}
        <span class="field-label">${p.pages.length > 1 ? 'Page colours' : 'Paper colour'}</span>
        ${colours}
        <div class="btn-row">${fills}</div>
        <p class="sub hint">Or drop a .collage file or a photo straight onto a page.</p>
      </div>
      <div class="psec">
        <h3>${U.icon('page')} Sheet</h3>
        <select id="zSheet">${Z.SHEETS.map((x) => `<option value="${x.id}" ${x.id === sh.preset ? 'selected' : ''}>${x.label}</option>`).join('')}</select>
        <div class="row" id="zCustom" ${sh.preset === 'custom' ? '' : 'hidden'}>
          <label class="num-field compact"><input type="number" id="zW" min="1" step="any" value="${fmt(sh.w)}"></label>
          <span class="times">×</span>
          <label class="num-field compact"><input type="number" id="zH" min="1" step="any" value="${fmt(sh.h)}"></label>
          <select id="zUnit" class="unit">${['mm', 'in'].map((u) => `<option ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </div>
        <p class="sub sheet-info">Landscape ${fmtSize(sh.w, sh.h)} · each page ${fmtSize(sh.w / 4, sh.h / 2)}</p>
        <label class="check"><input type="checkbox" id="zNumbers" ${Z.data.opts.numbers ? 'checked' : ''}> Page numbers on pages 2–7</label>
        <div class="row safe-row">
          <label class="check"><input type="checkbox" id="zSafe" ${Z.data.opts.safe ? 'checked' : ''}> Printer-safe margin guide</label>
          <label class="num-field compact"><input type="number" id="zSafeMm" min="1" max="20" step="0.5" value="${Z.data.opts.safeMm}">mm</label>
        </div>
        <div class="btn-row">
          <button class="pbtn" id="zPreview" data-icon="book" title="Turn the pages of the folded zine">Flip through</button>
          <button class="pbtn" id="zSheetView" data-icon="layout" title="See the printed sheet: both sides">Printed sheet</button>
        </div>
      </div>`;
  };

  Z.bindPanel = ($, on, rerender) => {
    const p = B.paper;
    if (!p.pages) return;
    (p.pages || []).forEach((pg, i) => {
      on('zPC' + i, 'input', (e) => {
        pg.color = e.target.value;
        if (p.pages.length === 1) p.color = e.target.value;
        B.canvas.requestRenderAll();
      });
      on('zPC' + i, 'change', () => B.commit());
    });
    U.$$('[data-zfill]', U.$('#props')).forEach((b) => (b.onclick = () => {
      const input = U.$('#zineFillInput');
      input.dataset.page = b.dataset.zfill;
      input.click();
    }));
    U.$$('#zOrient [data-v]').forEach((b) => (b.onclick = () => { Z.setPosterOrient(b.dataset.v); rerender(); }));
    on('zSheet', 'change', (e) => {
      if (e.target.value === 'custom') {
        Z.data.sheet.preset = 'custom';
        $('zCustom').hidden = false;
        CC.io.scheduleAutosave();
        return;
      }
      Z.setSheet(sheetFromPreset(e.target.value));
      rerender();
    });
    const applyCustom = () => {
      const unit = $('zUnit').value;
      let w = B.toPx(+$('zW').value, unit), h = B.toPx(+$('zH').value, unit);
      if (!(w > 0 && h > 0)) return;
      if (h > w) [w, h] = [h, w]; // the sheet is always used landscape
      if (w < B.toPx(80, 'mm') || w > 20000) { U.toast('That sheet size won’t work for a zine', 'warn'); return rerender(); }
      Z.setSheet({ preset: 'custom', unit, w: U.round(w, 3), h: U.round(h, 3) });
      rerender();
    };
    on('zW', 'change', applyCustom);
    on('zH', 'change', applyCustom);
    on('zUnit', 'change', (e) => { Z.data.sheet.unit = e.target.value; rerender(); });
    const opt = (k, v) => {
      Z.data.opts[k] = v;
      B.canvas.requestRenderAll();
      if (k === 'numbers') renderAllThumbs();
      CC.io.scheduleAutosave();
    };
    on('zNumbers', 'change', (e) => opt('numbers', e.target.checked));
    on('zSafe', 'change', (e) => opt('safe', e.target.checked));
    on('zSafeMm', 'change', (e) => { const v = U.clamp(+e.target.value || 5, 1, 20); e.target.value = v; opt('safeMm', v); if (Z.data.opts.numbers) renderAllThumbs(); });
    on('zPreview', 'click', Z.openPreview);
    on('zSheetView', 'click', () => setView('sheet'));
  };

  /* ---------- Mode UI ---------- */
  function syncModeUI() {
    document.body.classList.toggle('zine-mode', Z.active);
    U.$$('#modeSeg [data-mode]').forEach((b) => b.classList.toggle('on', (b.dataset.mode === 'zine') === Z.active));
    U.$('#zineStrip').hidden = !Z.active;
    U.$('#btnNew').title = Z.active ? 'New zine' : 'New collage';
    U.$('#btnSave').title = Z.active ? 'Save zine file (Ctrl+S)' : 'Save project file (Ctrl+S)';
    U.$('#btnExport').title = Z.active ? 'Export the zine as a PDF (Ctrl+E)' : 'Export PNG, JPEG or PDF (Ctrl+E)';
    U.$('#emptyHintText').textContent = Z.active
      ? 'Drop a .collage file or a photo onto a page, or click a photo in the tray to cut from it'
      : 'Click a photo in the tray to cut a piece out of it';
    if (!Z.active) U.$('#zineThumbs').innerHTML = '';
  }

  Z.init = () => {
    U.$$('#modeSeg [data-mode]').forEach((b) => (b.onclick = () => (b.dataset.mode === 'zine' ? Z.enter() : Z.exit())));
    U.$('#zineThumbs').addEventListener('click', (e) => {
      const b = e.target.closest('.zthumb');
      if (b) Z.go(b.dataset.id);
    });
    U.$$('#zineView [data-v]').forEach((b) => (b.onclick = () => setView(b.dataset.v)));
    U.$('#zinePreviewBtn').onclick = Z.openPreview;
    U.$$('[data-fold-link]').forEach((a) => (a.href = Z.FOLD_GUIDE_URL));
    U.$('#zsvFront').addEventListener('click', sheetClick);
    U.$('#zsvFront').addEventListener('mousemove', sheetHover);
    U.$('#zsvBack').addEventListener('click', () => Z.go('poster'));
    new ResizeObserver(U.debounce(() => { if (Z.active && Z.view === 'sheet') renderSheetView(); }, 120)).observe(U.$('#zineSheet'));
    const fillInput = U.$('#zineFillInput');
    fillInput.onchange = () => {
      const f = fillInput.files[0];
      if (f) Z.fillPage(+fillInput.dataset.page || 0, f);
      fillInput.value = '';
    };
    U.$$('#zxDpi button').forEach((b) => (b.onclick = () => { zx.dpi = +b.dataset.v; updateExportInfo(); }));
    U.$('#zxPoster').onchange = updateExportInfo;
    U.$('#zxGo').onclick = doExport;
    initPreview();
    CC.on('change', onChange);
    syncModeUI();
  };
})(window.CC);
