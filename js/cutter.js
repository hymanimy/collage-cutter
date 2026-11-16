'use strict';
/* The cutting window: draw lasso / polygon / rectangle / ellipse shapes over a photo, combine them with
   add/subtract, adjust them, then place the cut-out on the paper. All shape coordinates are in
   source-photo pixels, so cuts keep the photo's full resolution whatever the zoom. */
(function (CC) {
  const U = CC.util, G = CC.geo;
  const K = (CC.cutter = {});
  const el = {};
  let st = null;
  let lastTool = 'lasso';

  const HINTS = {
    adjust: 'Click a shape to select it · drag to move · drag the handles to resize · Delete removes it',
    lasso: 'Hold the mouse button and draw around what you want to keep. Let go to close the shape.',
    polygon: 'Click to place points · click the first point, double-click or press Enter to close · Backspace undoes a point',
    rect: 'Drag to draw a rectangle · drag the handles to adjust · Smooth rounds the corners',
    ellipse: 'Drag to draw an ellipse · drag the handles to adjust',
    magic: 'Click an object to select it · click the same spot again for a bigger or smaller selection · Shift-click adds, Alt-click subtracts',
  };
  const TOOL_KEYS = { v: 'adjust', l: 'lasso', p: 'polygon', r: 'rect', e: 'ellipse', w: 'magic' };
  const CAND_COLORS = ['#ff5d8f', '#4cc9f0', '#ffd23f', '#7bd88f', '#c77dff', '#ff9f1c', '#2ec4b6', '#f15bb5', '#00bbf9', '#fee440', '#9ef01a', '#ff6b6b'];
  const RESIZE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

  K.isOpen = () => !!st;
  const wholeOp = () => ({ type: 'rect', mode: 'add', x: 0, y: 0, w: st.W, h: st.H });

  K.init = () => {
    el.root = U.$('#cutter');
    el.stage = U.$('#cutStage');
    el.canvas = U.$('#cutCanvas');
    el.ctx = el.canvas.getContext('2d');
    el.overlay = document.createElement('canvas');
    el.mask = document.createElement('canvas');

    U.$$('#cutTools [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    U.$$('#cutModes [data-mode]').forEach((b) => (b.onclick = () => { st.mode = b.dataset.mode; updateUI(); }));
    const smooth = U.$('#cutSmooth'), feather = U.$('#cutFeather');
    smooth.oninput = () => { st.smooth = +smooth.value; U.$('#cutSmoothVal').textContent = smooth.value; st.dirty = true; draw(); };
    feather.oninput = () => { st.feather = +feather.value; U.$('#cutFeatherVal').textContent = feather.value; st.dirty = true; draw(); };
    U.$('#cutWhole').onclick = () => commitOp(wholeOp(), 'replace');
    U.$('#cutClear').onclick = () => { if (st.ops.length) { pushUndo(); st.ops = []; afterOpsChange(); } };
    U.$('#cutUndo').onclick = undo;
    U.$('#cutRedo').onclick = redo;
    U.$('#cutZoomIn').onclick = () => zoomAt(1.25);
    U.$('#cutZoomOut').onclick = () => zoomAt(0.8);
    U.$('#cutFit').onclick = () => { fit(); draw(); };
    U.$('#cutCancel').onclick = () => K.cancel();
    U.$('#cutPlace').onclick = () => place(false);
    U.$('#cutPlaceMore').onclick = () => place(true);
    U.$('#cutFind').onclick = () => findObjects();
    CC.ai.onStatus = showAIStatus;
    const panel = U.$('#candPanel');
    panel.addEventListener('click', onCandPanelClick);
    panel.addEventListener('mouseover', (e) => {
      const row = e.target.closest('[data-cand]');
      const id = row ? row.dataset.cand : null;
      if (st && st.candHover !== id) { st.candHover = id; draw(); }
    });
    panel.addEventListener('mouseleave', () => { if (st) { st.candHover = null; draw(); } });

    const cv = el.canvas;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', () => { if (st && !st.drawing) { st.hover = null; draw(); } });
    cv.addEventListener('dblclick', () => { if (st && st.drawing && st.drawing.type === 'polygon') finishPolygon(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', (e) => {
      if (st && e.key === ' ') { st.space = false; updateCursor(); }
    }, true);
    window.addEventListener('blur', () => { if (st) st.space = false; });
    new ResizeObserver(() => { if (st) { resize(); draw(); } }).observe(el.stage);
  };

  /* ---------- Open / close ---------- */
  K.open = (src, { cut = null, onPlace }) => {
    st = {
      src, img: src.img, W: src.w, H: src.h, diag: Math.hypot(src.w, src.h),
      ops: cut ? cut.ops.slice() : [],
      sel: cut ? cut.ops.length - 1 : -1,
      smooth: cut ? cut.smooth : 0,
      feather: cut ? cut.feather : 0,
      tool: cut ? 'adjust' : lastTool,
      mode: 'replace',
      view: { s: 1, x: 0, y: 0 },
      undo: [], redo: [],
      drawing: null, drag: null, pan: null, space: false, hover: null,
      editing: !!cut, dirty: false, placedAny: false, onPlace,
      token: Symbol('cutter'), cands: null, candHover: null, aiBusy: false, magicLast: null, magicPending: null,
    };
    U.$('#candPanel').hidden = true;
    el.root.hidden = false;
    U.$('#cutTitle').innerHTML = `${cut ? 'Re-edit cut' : 'Cut out'} <span>${U.esc(src.name)}</span>`;
    U.$('#cutSmooth').value = st.smooth;
    U.$('#cutFeather').value = st.feather;
    U.$('#cutSmoothVal').textContent = st.smooth;
    U.$('#cutFeatherVal').textContent = st.feather;
    U.$('#cutPlaceMore').hidden = !!cut;
    resize();
    fit();
    updateUI();
    draw();
    // If the AI models are already on this computer, quietly analyse the photo now so that
    // Magic select and Find objects respond instantly.
    const token = st.token;
    CC.ai.isInstalled().then((yes) => {
      if (yes && st && st.token === token) CC.ai.encode(src).catch(() => {});
    });
  };

  K.close = () => {
    st = null;
    el.root.hidden = true;
  };

  K.cancel = async () => {
    if (!st) return;
    if (st.dirty && st.ops.length) {
      const ok = await U.confirm({ title: 'Discard this cut?', message: 'The shape you drew hasn’t been placed on the paper yet.', ok: 'Discard', danger: true });
      if (!ok) return;
    }
    K.close();
  };

  function place(keepOpen) {
    if (!st) return;
    if (st.drawing && st.drawing.type === 'polygon') finishPolygon();
    // Nothing drawn (or only holes)? Use the whole photo, minus any subtract shapes.
    const ops = st.ops.some((o) => o.mode !== 'sub') ? st.ops : [wholeOp(), ...st.ops];
    const cut = CC.cuts.add({ sourceId: st.src.id, ops: cleanOps(ops), smooth: st.smooth, feather: st.feather });
    if (!CC.cuts.entry(cut.id)) {
      U.toast('That selection doesn’t cover any of the photo', 'warn');
      return;
    }
    st.onPlace(cut);
    if (keepOpen) {
      pushUndo();
      st.ops = [];
      st.sel = -1;
      st.dirty = false;
      st.magicLast = null;
      updateUI();
      renderCandPanel();
      draw();
      U.toast('Placed! Cut out another piece', 'ok', 1800);
    } else {
      K.close();
    }
  }

  // ops carry 'cand' / 'magic' tags while cutting; they aren't part of the saved cut
  const cleanOps = (ops) => ops.map(({ cand, magic, ...o }) => o);

  /* ---------- AI: Find objects & Magic select ---------- */
  function showAIStatus(text, frac) {
    const box = U.$('#aiStatus');
    box.hidden = !text;
    if (!text) return;
    U.$('#aiStatusText').textContent = text;
    U.$('#aiBarWrap').hidden = frac == null;
    if (frac != null) U.$('#aiBar').style.width = Math.round(frac * 100) + '%';
  }

  function aiError(e) {
    if (e && e.message === 'cancelled') return;
    console.error(e);
    U.toast('AI: ' + ((e && e.message) || e), 'error', 6000);
  }

  async function findObjects() {
    if (!st || st.aiBusy) return;
    const token = st.token;
    st.aiBusy = true;
    updateUI();
    try {
      const cands = await CC.ai.detect(st.src);
      if (!st || st.token !== token) return;
      st.cands = cands.map((c, i) => ({ ...c, color: CAND_COLORS[i % CAND_COLORS.length], bounds: opsBounds(c.ops) }));
      if (!st.cands.length) U.toast('No objects recognised. Try Magic select (W) and click the thing you want.', 'warn', 5000);
      renderCandPanel();
    } catch (e) {
      aiError(e);
    } finally {
      if (st && st.token === token) { st.aiBusy = false; updateUI(); draw(); }
    }
  }

  function opsBounds(ops) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const op of ops) {
      if (op.mode === 'sub') continue;
      const b = G.opBounds(op);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const candChecked = (id) => st.ops.some((o) => o.cand === id);

  function renderCandPanel() {
    const panel = U.$('#candPanel');
    if (!st || !st.cands || !st.cands.length) { panel.hidden = true; return; }
    const n = st.cands.filter((c) => candChecked(c.id)).length;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="cand-head"><strong>${st.cands.length} object${st.cands.length > 1 ? 's' : ''} found</strong>
        <button class="cand-x" data-act="close" title="Hide">${U.icon('x')}</button></div>
      <p class="cand-tip">Tick the ones you want. Fine-tune with the other tools.</p>
      <div class="cand-list">${st.cands.map((c) => `
        <label class="cand-row${candChecked(c.id) ? ' on' : ''}" data-cand="${c.id}">
          <input type="checkbox" ${candChecked(c.id) ? 'checked' : ''}>
          <span class="cand-dot" style="background:${c.color}"></span>
          <span class="cand-name">${U.esc(c.label)}</span>
          <span class="cand-score">${Math.round(c.score * 100)}%</span>
        </label>`).join('')}</div>
      <div class="cand-foot">
        <button class="cand-btn" data-act="all">${n === st.cands.length ? 'Untick all' : 'Tick all'}</button>
        ${st.editing ? '' : `<button class="cand-btn primary" data-act="separate" ${n ? '' : 'disabled'} title="Place each ticked object as its own piece">Place ${n || ''} separately</button>`}
      </div>`;
  }

  function onCandPanelClick(e) {
    if (!st) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'close') { st.cands = null; st.candHover = null; renderCandPanel(); draw(); }
      else if (a === 'all') {
        const all = st.cands.every((c) => candChecked(c.id));
        pushUndo();
        st.ops = st.ops.filter((o) => !o.cand);
        if (!all) for (const c of st.cands) st.ops = [...st.ops, ...c.ops.map((o) => ({ ...o, cand: c.id }))];
        afterOpsChange();
      } else if (a === 'separate') placeSeparately();
      return;
    }
    const row = e.target.closest('[data-cand]');
    if (row) {
      e.preventDefault(); // we manage the checkbox ourselves
      toggleCand(row.dataset.cand);
    }
  }

  function toggleCand(id) {
    const c = st.cands.find((x) => x.id === id);
    if (!c) return;
    pushUndo();
    if (candChecked(id)) st.ops = st.ops.filter((o) => o.cand !== id);
    else st.ops = [...st.ops, ...c.ops.map((o) => ({ ...o, cand: id }))];
    afterOpsChange();
  }

  function afterOpsChange() {
    st.sel = -1;
    st.dirty = true;
    updateUI();
    renderCandPanel();
    draw();
  }

  function placeSeparately() {
    const picked = st.cands.filter((c) => candChecked(c.id));
    let n = 0;
    for (const c of picked) {
      const ops = cleanOps(st.ops.filter((o) => o.cand === c.id));
      const cut = CC.cuts.add({ sourceId: st.src.id, ops, smooth: st.smooth, feather: st.feather });
      if (CC.cuts.entry(cut.id)) { st.onPlace(cut); n++; }
    }
    if (n) U.toast(`Placed ${n} piece${n > 1 ? 's' : ''}`, 'ok');
    K.close();
  }

  async function magicClick(p, mode) {
    if (st.aiBusy) return;
    const last = st.magicLast;
    // clicking the same spot again cycles through SAM's alternative (smaller / bigger) selections
    if (last && last.mode === mode && Math.hypot(last.p.x - p.x, last.p.y - p.y) * st.view.s <= 6 && st.ops.some((o) => o.magic === last.gid)) {
      last.idx = (last.idx + 1) % last.alts.length;
      applyMagic(last, false);
      return;
    }
    const token = st.token;
    st.aiBusy = true;
    st.magicPending = { x: p.x, y: p.y };
    updateUI();
    draw();
    try {
      const alts = await CC.ai.point(st.src, p.x, p.y);
      if (!st || st.token !== token) return;
      if (!alts.length) { U.toast('Couldn’t find an object there. Try clicking nearer its middle.', 'warn'); return; }
      let best = 0;
      alts.forEach((a, i) => { if (a.score > alts[best].score) best = i; });
      st.magicLast = { p: { x: p.x, y: p.y }, mode, alts, idx: best, gid: U.uid('m') };
      applyMagic(st.magicLast, true);
    } catch (e) {
      aiError(e);
    } finally {
      if (st && st.token === token) { st.aiBusy = false; st.magicPending = null; updateUI(); draw(); }
    }
  }

  function applyMagic(m, isNew) {
    const alt = m.alts[m.idx];
    const ops = alt.ops
      .filter((o) => m.mode !== 'sub' || o.mode === 'add')
      .map((o) => ({ ...o, mode: m.mode === 'sub' ? 'sub' : o.mode, magic: m.gid }));
    pushUndo();
    const base = isNew ? (m.mode === 'replace' ? [] : st.ops) : st.ops.filter((o) => o.magic !== m.gid);
    st.ops = [...base, ...ops];
    afterOpsChange();
    if (m.alts.length > 1) {
      st.hint = `Magic select: option ${m.idx + 1} of ${m.alts.length} (smallest to biggest). Click the same spot again to switch.`;
      updateUI();
    }
  }

  /* ---------- View ---------- */
  function resize() {
    const r = el.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    st.dpr = dpr;
    st.cw = r.width;
    st.ch = r.height;
    for (const c of [el.canvas, el.overlay, el.mask]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    el.canvas.style.width = r.width + 'px';
    el.canvas.style.height = r.height + 'px';
  }

  function fit() {
    const s = Math.min((st.cw - 48) / st.W, (st.ch - 48) / st.H);
    st.fitS = s;
    st.view = { s, x: (st.cw - st.W * s) / 2, y: (st.ch - st.H * s) / 2 };
  }

  function zoomAt(f, cx = st.cw / 2, cy = st.ch / 2) {
    const v = st.view;
    const s = U.clamp(v.s * f, st.fitS * 0.25, 40);
    const k = s / v.s;
    st.view = { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    draw();
  }

  function onWheel(e) {
    if (!st) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      const p = toSrc(e);
      zoomAt(Math.exp(-e.deltaY * k * 0.0025 * (e.ctrlKey && !Number.isInteger(e.deltaY) ? 4 : 1)), p.cx, p.cy);
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      st.view.x -= dx * k;
      st.view.y -= dy * k;
      draw();
    }
  }

  function toSrc(e) {
    const r = el.canvas.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    return { x: (cx - st.view.x) / st.view.s, y: (cy - st.view.y) / st.view.s, cx, cy };
  }
  const screenDist = (a, b) => Math.hypot(a[0] - b.x, a[1] - b.y) * st.view.s;

  /* ---------- Tools & state ---------- */
  function setTool(t) {
    if (!st) return;
    st.drawing = null;
    st.hint = null;
    st.tool = t;
    if (t !== 'adjust') lastTool = t;
    updateUI();
    draw();
  }

  function updateUI() {
    if (!st) return;
    U.$$('#cutTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    U.$$('#cutModes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    U.$('#cutHint').textContent = st.hint || HINTS[st.tool];
    U.$('#cutUndo').disabled = !st.undo.length && !st.drawing;
    U.$('#cutRedo').disabled = !st.redo.length;
    const has = st.ops.some((o) => o.mode !== 'sub');
    U.$('#cutPlace').textContent = st.editing ? 'Update piece' : has ? 'Place on paper' : 'Place whole photo';
    U.$('#cutPlace').title = has || st.editing ? 'Place the piece on the paper (Enter)' : 'Nothing drawn yet: place the whole photo (Enter)';
    U.$('#cutModes').classList.toggle('dim', st.tool === 'adjust');
    U.$('#cutFind').disabled = st.aiBusy;
    updateCursor();
  }

  function pushUndo(before = st.ops) {
    st.undo.push(before);
    if (st.undo.length > 100) st.undo.shift();
    st.redo = [];
  }
  function undo() {
    if (!st) return;
    if (st.drawing) { st.drawing = null; updateUI(); draw(); return; }
    if (!st.undo.length) return;
    st.redo.push(st.ops);
    st.ops = st.undo.pop();
    st.sel = Math.min(st.sel, st.ops.length - 1);
    if (st.sel < 0 && st.ops.length) st.sel = st.ops.length - 1;
    updateUI();
    renderCandPanel();
    draw();
  }
  function redo() {
    if (!st || !st.redo.length) return;
    st.undo.push(st.ops);
    st.ops = st.redo.pop();
    st.sel = st.ops.length - 1;
    updateUI();
    renderCandPanel();
    draw();
  }

  function commitOp(shape, mode) {
    const op = { ...shape, mode: mode === 'sub' ? 'sub' : 'add' };
    pushUndo();
    st.ops = mode === 'replace' ? [op] : [...st.ops, op];
    st.sel = st.ops.length - 1;
    st.dirty = true;
    updateUI();
    renderCandPanel();
    draw();
  }

  function deleteSelectedOp() {
    if (st.sel < 0 || !st.ops[st.sel]) return;
    pushUndo();
    st.ops = st.ops.filter((_, i) => i !== st.sel);
    st.sel = st.ops.length - 1;
    updateUI();
    renderCandPanel();
    draw();
  }

  function finishPolygon() {
    const d = st.drawing;
    st.drawing = null;
    if (!d) return;
    const pts = [];
    for (const p of d.points) {
      const prev = pts[pts.length - 1];
      if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) * st.view.s > 3) pts.push(p);
    }
    if (pts.length >= 3) commitOp({ type: 'polygon', points: G.roundPts(pts) }, d.mode);
    else { updateUI(); draw(); }
  }

  /* ---------- Hit testing ---------- */
  function handlesActive() {
    if (!st || st.drawing || st.sel < 0) return false;
    const op = st.ops[st.sel];
    if (!op || op.type === 'lasso') return false;
    return st.tool === 'adjust' || st.tool === op.type;
  }

  function handlesOf(op) {
    if (op.type === 'rect' || op.type === 'ellipse') {
      const { x, y, w, h } = op;
      return [['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2]];
    }
    if (op.type === 'polygon') return op.points.map((p, i) => [i, p[0], p[1]]);
    return [];
  }

  function hitHandle(p) {
    if (!handlesActive()) return null;
    const hs = handlesOf(st.ops[st.sel]);
    for (let i = hs.length - 1; i >= 0; i--) {
      if (Math.hypot(hs[i][1] - p.x, hs[i][2] - p.y) * st.view.s <= 8) return { key: hs[i][0] };
    }
    return null;
  }

  function hitOp(p) {
    for (let i = st.ops.length - 1; i >= 0; i--) if (G.pointInOp(st.ops[i], p.x, p.y, st.smooth, st.diag)) return i;
    return -1;
  }

  function translateOp(op, dx, dy) {
    if (op.type === 'rect' || op.type === 'ellipse') return { ...op, x: op.x + dx, y: op.y + dy };
    return { ...op, points: op.points.map(([x, y]) => [x + dx, y + dy]) };
  }

  function resizeBox(o, key, p) {
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    if (key.includes('w')) x0 = p.x;
    if (key.includes('e')) x1 = p.x;
    if (key.includes('n')) y0 = p.y;
    if (key.includes('s')) y1 = p.y;
    return { ...o, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }

  function boxFromDrag(d) {
    return { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
  }

  /* ---------- Pointer handling ---------- */
  function onDown(e) {
    if (!st) return;
    el.canvas.setPointerCapture(e.pointerId);
    const p = toSrc(e);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && st.space)) {
      st.pan = { x: e.clientX, y: e.clientY };
      updateCursor();
      return;
    }
    if (e.button !== 0) return;

    const d = st.drawing;
    if (d && d.type === 'polygon') {
      if (d.points.length >= 3 && screenDist(d.points[0], p) <= 9) finishPolygon();
      else { d.points.push([p.x, p.y]); draw(); }
      updateUI();
      return;
    }

    const h = hitHandle(p);
    if (h) {
      st.drag = { kind: 'handle', key: h.key, before: st.ops, orig: st.ops[st.sel], start: p };
      return;
    }
    if (st.tool === 'adjust') {
      st.sel = hitOp(p);
      if (st.sel >= 0) st.drag = { kind: 'move', before: st.ops, orig: st.ops[st.sel], start: p };
      draw();
      return;
    }

    const mode = e.shiftKey ? 'add' : e.altKey ? 'sub' : st.mode;
    if (st.tool === 'magic') {
      if (p.x >= 0 && p.y >= 0 && p.x <= st.W && p.y <= st.H) magicClick(p, mode);
      return;
    }
    if (st.tool === 'lasso') st.drawing = { type: 'lasso', mode, points: [[p.x, p.y]], last: p };
    else if (st.tool === 'polygon') st.drawing = { type: 'polygon', mode, points: [[p.x, p.y]], hover: p };
    else st.drawing = { type: st.tool, mode, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    updateUI();
    draw();
  }

  function onMove(e) {
    if (!st) return;
    const p = toSrc(e);
    st.hover = p;
    if (st.pan) {
      st.view.x += e.clientX - st.pan.x;
      st.view.y += e.clientY - st.pan.y;
      st.pan = { x: e.clientX, y: e.clientY };
      draw();
      return;
    }
    if (st.drag) {
      const d = st.drag;
      let op;
      if (d.kind === 'move') op = translateOp(d.orig, p.x - d.start.x, p.y - d.start.y);
      else if (d.orig.type === 'polygon') {
        const pts = d.orig.points.slice();
        pts[d.key] = [p.x, p.y];
        op = { ...d.orig, points: pts };
      } else op = resizeBox(d.orig, d.key, p);
      st.ops = st.ops.map((o, i) => (i === st.sel ? op : o));
      draw();
      return;
    }
    const d = st.drawing;
    if (d) {
      if (d.type === 'lasso') {
        // use coalesced events for a smooth freehand line
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of evs.length ? evs : [e]) {
          const q = toSrc(ce);
          if (Math.hypot(q.cx - d.last.cx, q.cy - d.last.cy) >= 1.5) {
            d.points.push([q.x, q.y]);
            d.last = q;
          }
        }
      } else if (d.type === 'polygon') d.hover = p;
      else { d.x1 = p.x; d.y1 = p.y; }
      draw();
      return;
    }
    updateCursor(p);
    if (st.tool === 'polygon') draw();
  }

  function onUp() {
    if (!st) return;
    if (st.pan) { st.pan = null; updateCursor(); return; }
    if (st.drag) {
      const d = st.drag;
      st.drag = null;
      if (st.ops !== d.before) {
        // normalise rounding once the drag ends
        st.ops = st.ops.map((o, i) => (i === st.sel ? roundOp(o) : o));
        pushUndo(d.before);
        st.dirty = true;
      }
      updateUI();
      draw();
      return;
    }
    const d = st.drawing;
    if (!d || d.type === 'polygon') return;
    st.drawing = null;
    const s = st.view.s;
    if (d.type === 'lasso') {
      const pts = G.roundPts(G.simplify(d.points, 0.6 / s));
      const b = G.opBounds({ points: pts });
      if (pts.length >= 3 && b.w * s >= 4 && b.h * s >= 4) commitOp({ type: 'lasso', points: pts }, d.mode);
    } else {
      const b = boxFromDrag(d);
      if (b.w * s >= 3 && b.h * s >= 3) commitOp(roundOp({ type: d.type, ...b }), d.mode);
    }
    updateUI();
    draw();
  }

  function roundOp(o) {
    if (o.points) return { ...o, points: G.roundPts(o.points) };
    const r = (v) => Math.round(v * 10) / 10;
    return { ...o, x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h) };
  }

  function onKey(e) {
    if (!st) return;
    if (U.anyModalOpen()) return;
    const k = e.key;
    const lk = k.length === 1 ? k.toLowerCase() : k;
    const mod = U.mod(e);
    const d = st.drawing;
    if (k === ' ') { st.space = true; updateCursor(); }
    else if (mod && lk === 'z') (e.shiftKey ? redo : undo)();
    else if (mod && lk === 'y') redo();
    else if (k === 'Enter') {
      if (d && d.type === 'polygon') finishPolygon();
      else place(e.shiftKey && !st.editing);
    } else if (k === 'Escape') {
      if (d) { st.drawing = null; updateUI(); draw(); }
      else K.cancel();
    } else if (k === 'Backspace' || k === 'Delete') {
      if (d && d.type === 'polygon' && k === 'Backspace') {
        d.points.pop();
        if (!d.points.length) st.drawing = null;
        updateUI();
        draw();
      } else if (!d) deleteSelectedOp();
    } else if (!mod && !e.altKey && TOOL_KEYS[lk]) setTool(TOOL_KEYS[lk]);
    else if (!mod && !e.altKey && lk === 'f') findObjects();
    else if (!mod && (k === '+' || k === '=')) zoomAt(1.25);
    else if (!mod && (k === '-' || k === '_')) zoomAt(0.8);
    else if (!mod && k === '0') { fit(); draw(); }
    else if (k === 'Tab') { /* keep focus inside */ }
    else if (mod) return; // let browser shortcuts like Ctrl+R through
    else { e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
  }

  function updateCursor(p = st && st.hover) {
    if (!st) return;
    let c = st.tool === 'adjust' ? 'default' : st.tool === 'magic' ? 'cell' : 'crosshair';
    if (st.aiBusy) c = 'progress';
    if (st.pan) c = 'grabbing';
    else if (st.space) c = 'grab';
    else if (p) {
      const h = hitHandle(p);
      if (h) c = typeof h.key === 'number' ? 'move' : RESIZE_CURSORS[h.key];
      else if (st.tool === 'adjust' && hitOp(p) >= 0) c = 'move';
    }
    el.canvas.style.cursor = c;
  }

  /* ---------- Rendering ---------- */
  function previewOp() {
    const d = st.drawing;
    if (!d) return null;
    let op = null;
    if (d.type === 'lasso' && d.points.length >= 3) op = { type: 'lasso', points: d.points };
    else if (d.type === 'polygon' && d.points.length >= 2) op = { type: 'polygon', points: d.hover ? [...d.points, [d.hover.x, d.hover.y]] : d.points };
    else if (d.type === 'rect' || d.type === 'ellipse') {
      const b = boxFromDrag(d);
      if (b.w > 0 && b.h > 0) op = { type: d.type, ...b };
    }
    if (op) op.mode = d.mode === 'sub' ? 'sub' : 'add';
    return op;
  }

  function effectiveOps() {
    const op = previewOp();
    if (!op) return st.ops;
    return st.drawing.mode === 'replace' ? [op] : [...st.ops, op];
  }

  const draw = U.rafThrottle(render);

  function render() {
    if (!st) return;
    const ctx = el.ctx, dpr = st.dpr, v = st.view;
    const T = [dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

    // photo (on a light card so transparent PNGs read clearly)
    ctx.setTransform(...T);
    ctx.fillStyle = '#e9e6df';
    ctx.fillRect(0, 0, st.W, st.H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.img, 0, 0, st.W, st.H);

    const ops = effectiveOps();
    if (ops.length) {
      const o = el.overlay, octx = o.getContext('2d');
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, o.width, o.height);
      octx.fillStyle = 'rgba(14,16,18,0.68)';
      octx.fillRect(0, 0, o.width, o.height);
      const m = el.mask, mctx = m.getContext('2d');
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, m.width, m.height);
      mctx.setTransform(...T);
      G.renderMask(mctx, ops, st.smooth, st.diag);
      octx.globalCompositeOperation = 'destination-out';
      const f = G.featherPx(st.feather, st.diag) * v.s * dpr;
      if (f > 0.3) octx.filter = `blur(${f.toFixed(2)}px)`;
      octx.drawImage(m, 0, 0);
      octx.filter = 'none';
      octx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(o, 0, 0);
    }

    // outlines
    ctx.setTransform(...T);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const selOp = st.ops[st.sel];
    for (const op of ops) {
      const path = G.opPath(op, st.smooth, st.diag);
      const isSel = op === selOp && st.tool === 'adjust';
      ctx.setLineDash([]);
      ctx.lineWidth = (isSel ? 4 : 3) / v.s;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke(path);
      ctx.setLineDash([6 / v.s, 5 / v.s]);
      ctx.lineWidth = (isSel ? 2 : 1.5) / v.s;
      ctx.strokeStyle = op.mode === 'sub' ? '#e4572e' : isSel ? '#e4572e' : '#16181a';
      ctx.stroke(path);
    }
    ctx.setLineDash([]);

    // lasso in progress: show the raw stroke too
    const d = st.drawing;
    if (d && d.type === 'lasso' && d.points.length > 1) {
      ctx.beginPath();
      d.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = 2 / v.s;
      ctx.strokeStyle = '#e4572e';
      ctx.stroke();
    }

    // polygon in progress: edges, rubber band, vertices
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toScr = (x, y) => [v.x + x * v.s, v.y + y * v.s];
    if (d && d.type === 'polygon') {
      ctx.beginPath();
      d.points.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      if (d.hover) { const [sx, sy] = toScr(d.hover.x, d.hover.y); ctx.lineTo(sx, sy); }
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e4572e';
      ctx.stroke();
      const nearFirst = d.hover && d.points.length >= 3 && screenDist(d.points[0], d.hover) <= 9;
      d.points.forEach(([x, y], i) => {
        const [sx, sy] = toScr(x, y);
        ctx.beginPath();
        ctx.arc(sx, sy, i === 0 ? (nearFirst ? 8 : 6) : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 && nearFirst ? '#e4572e' : '#fff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#16181a';
        ctx.stroke();
      });
    }

    // AI candidates that aren't ticked yet: coloured outlines + name tags
    if (st.cands) {
      for (const c of st.cands) {
        if (candChecked(c.id)) continue;
        const hov = st.candHover === c.id;
        ctx.setTransform(...T);
        for (const op of c.ops) {
          if (op.mode === 'sub') continue;
          const path = G.opPath(op, 0, st.diag);
          if (hov) { ctx.globalAlpha = 0.35; ctx.fillStyle = c.color; ctx.fill(path); ctx.globalAlpha = 1; }
          ctx.lineWidth = (hov ? 3 : 2) / v.s;
          ctx.strokeStyle = c.color;
          ctx.stroke(path);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [lx, ly] = toScr(c.bounds.x, c.bounds.y);
        ctx.font = '600 12px system-ui, sans-serif';
        const tw = ctx.measureText(c.label).width + 12;
        const tx = Math.max(2, lx), ty = Math.max(2, ly - 20);
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(tx, ty, tw, 18, 4) : ctx.rect(tx, ty, tw, 18);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillText(c.label, tx + 6, ty + 13);
      }
    }
    if (st.magicPending) {
      const [mx, my] = toScr(st.magicPending.x, st.magicPending.y);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#e4572e';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    // handles for the selected shape
    if (handlesActive()) {
      for (const [key, x, y] of handlesOf(st.ops[st.sel])) {
        const [sx, sy] = toScr(x, y);
        ctx.beginPath();
        if (typeof key === 'number') ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        else ctx.rect(sx - 5, sy - 5, 10, 10);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#e4572e';
        ctx.stroke();
      }
    }
  }
})(window.CC);
