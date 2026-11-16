'use strict';
/* The paper: a Fabric.js canvas covering the whole workspace. The paper itself is painted as the
   canvas background (at canvas coords 0,0 → paper.w,paper.h); anything hanging off the paper is dimmed
   and gets trimmed on export, like a real collage. Also owns serialisation and undo/redo. */
(function (CC) {
  const U = CC.util;
  const B = (CC.board = { ready: false, exporting: null, restoring: false });
  const ACCENT = '#e4572e';
  const PX_PER_MM = 96 / 25.4;

  /* ---------- Paper presets ---------- */
  B.PRESETS = [
    { id: 'a4', label: 'A4', w: 210, h: 297, unit: 'mm' },
    { id: 'a3', label: 'A3', w: 297, h: 420, unit: 'mm' },
    { id: 'a5', label: 'A5', w: 148, h: 210, unit: 'mm' },
    { id: 'letter', label: 'US Letter', w: 8.5, h: 11, unit: 'in' },
    { id: 'legal', label: 'US Legal', w: 8.5, h: 14, unit: 'in' },
    { id: 'sq8', label: 'Square 8″', w: 8, h: 8, unit: 'in' },
    { id: 'sq12', label: 'Scrapbook 12″', w: 12, h: 12, unit: 'in' },
    { id: 'post', label: 'Postcard 6×4″', w: 4, h: 6, unit: 'in' },
    { id: 'insta', label: 'Square post 1080px', w: 1080, h: 1080, unit: 'px' },
    { id: 'story', label: 'Story 1080×1920px', w: 1080, h: 1920, unit: 'px' },
    { id: 'custom', label: 'Custom…' },
  ];
  B.toPx = (v, unit) => (unit === 'mm' ? v * PX_PER_MM : unit === 'in' ? v * 96 : v);
  B.fromPx = (v, unit) => (unit === 'mm' ? v / PX_PER_MM : unit === 'in' ? v / 96 : v);

  const DEFAULT_PAPER = { preset: 'a4', orient: 'portrait', unit: 'mm', w: U.round(210 * PX_PER_MM, 3), h: U.round(297 * PX_PER_MM, 3), color: '#ffffff' };
  B.paper = { ...DEFAULT_PAPER };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  B.setPaper = (p, { silent = false, keepView = false } = {}) => {
    B.paper = { ...B.paper, ...p };
    B.paper.w = Math.max(16, U.round(B.paper.w, 3));
    B.paper.h = Math.max(16, U.round(B.paper.h, 3));
    if (!keepView) B.fit();
    B.canvas.requestRenderAll();
    if (!silent) B.commit();
  };

  B.applyPreset = (id, orient = B.paper.orient) => {
    const pr = B.PRESETS.find((p) => p.id === id);
    if (!pr || id === 'custom') {
      B.setPaper({ preset: 'custom' }, { keepView: true });
      return;
    }
    let w = B.toPx(pr.w, pr.unit), h = B.toPx(pr.h, pr.unit);
    if ((orient === 'landscape') !== w > h && w !== h) [w, h] = [h, w];
    B.setPaper({ preset: id, orient, unit: pr.unit, w, h });
  };

  /* ---------- Fabric customisation ---------- */
  function setupFabric() {
    Object.assign(fabric.Object.prototype, {
      originX: 'center',
      originY: 'center',
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: ACCENT,
      borderColor: ACCENT,
      cornerStyle: 'circle',
      cornerSize: 11,
      borderScaleFactor: 1.6,
      objectCaching: false,
      // Magnetic straightening: within 5° of 0/90/180/270 the rotation clicks to the right angle.
      snapAngle: 90,
      snapThreshold: 5,
    });
    fabric.Object.prototype.controls.mtr.offsetY = -32;
    fabric.Object.prototype.controls.mtr.withConnection = true;

    /* Images: draw from a mipmap level that matches the on-screen size — crisp and fast in every browser. */
    const origFill = fabric.Image.prototype._renderFill;
    fabric.Image.prototype._renderFill = function (ctx) {
      const mips = this._mips;
      if (!mips) return origFill.call(this, ctx);
      const t = ctx.getTransform();
      const s = Math.hypot(t.a, t.b) * Math.max(Math.abs(this.width / mips[0].width), 1e-6);
      let lvl = mips[0];
      for (const m of mips) {
        if (m.width / mips[0].width >= s) lvl = m;
        else break;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(lvl, -this.width / 2, -this.height / 2, this.width, this.height);
    };

    /* Pieces can be trimmed to one page of a zine spread (o.clip = page index on the paper). */
    const origRender = fabric.Object.prototype.render;
    fabric.Object.prototype.render = function (ctx) {
      const r = clipRectFor(this);
      if (!r) return origRender.call(this, ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      origRender.call(this, ctx);
      ctx.restore();
    };

    /* Text with an optional rounded "label" box behind it. Box padding/radius are fractions of fontSize. */
    fabric.CollageText = fabric.util.createClass(fabric.IText, {
      type: 'collageText',
      boxColor: '',
      boxPad: 0.25,
      boxRadius: 0.15,
      boxPadPx() { return this.boxColor ? this.boxPad * this.fontSize : 0; },
      _renderBackground(ctx) {
        if (!this.boxColor) return;
        const pad = this.boxPadPx();
        const w = this.width + pad * 2, h = this.height + pad * 2;
        const r = Math.min(this.boxRadius * this.fontSize, w / 2, h / 2);
        const x = -w / 2, y = -h / 2;
        ctx.fillStyle = this.boxColor;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
        this._removeShadow(ctx);
      },
    });
  }

  /* ---------- Init ---------- */
  B.init = () => {
    setupFabric();
    const ws = U.$('#workspace');
    const c = (B.canvas = new fabric.Canvas('board', {
      width: ws.clientWidth,
      height: ws.clientHeight,
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
      selectionColor: 'rgba(228,87,46,0.08)',
      selectionBorderColor: ACCENT,
      selectionLineWidth: 1.5,
      stopContextMenu: true,
      targetFindTolerance: 4,
    }));
    c._renderBackground = drawPaper;
    c._renderOverlay = drawOverlay;

    new ResizeObserver(() => {
      c.setDimensions({ width: ws.clientWidth, height: ws.clientHeight });
      syncView();
    }).observe(ws);

    setupNavigation(ws);
    setupEvents();
    B.ready = true;
    B.fit();
  };

  /* The paper a canvas shows: the live board's, or the one an offscreen renderer is drawing. */
  const paperOf = (cv) => (cv && cv.paperState) || B.paper;
  const isOutput = (cv) => !!(cv && cv.isRenderer) || !!B.exporting;

  function clipRectFor(o) {
    if (o.clip == null) return null;
    const cv = o.canvas;
    if (!cv) return null;
    const p = paperOf(cv);
    return (p.pages && p.pages[o.clip]) || null;
  }

  function drawPaper(ctx) {
    const v = this.viewportTransform, p = paperOf(this);
    const out = isOutput(this);
    if (!this.isRenderer && B.exporting && B.exporting.transparent) return;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    if (!out) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 6;
    }
    ctx.fillStyle = p.color;
    ctx.fillRect(0, 0, p.w, p.h);
    ctx.shadowColor = 'transparent';
    // zine pages can each have their own colour
    for (const pg of p.pages || []) {
      if (!pg.color || pg.color === p.color) continue;
      ctx.fillStyle = pg.color;
      ctx.fillRect(pg.x, pg.y, pg.w, pg.h);
    }
    ctx.restore();
  }

  function drawOverlay(ctx) {
    const out = isOutput(this);
    if (!out) drawOffPaperDim.call(this, ctx);
    // extra decoration (zine page numbers, guides); `editor` is false for exports and previews
    if (B.decorate) B.decorate(ctx, this.viewportTransform, paperOf(this), { editor: !out });
  }

  function drawOffPaperDim(ctx) {
    const v = this.viewportTransform, p = B.paper;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -10, this.width + 20, this.height + 20);
    ctx.rect(v[4], v[5], p.w * v[0], p.h * v[3]);
    ctx.fillStyle = 'rgba(44, 74, 64, 0.62)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  /* ---------- View: zoom & pan ---------- */
  B.zoom = () => B.canvas.getZoom();

  function setVpt(z, x, y) {
    B.canvas.setViewportTransform([z, 0, 0, z, x, y]);
    syncView();
  }

  function syncView() {
    const v = B.canvas.viewportTransform;
    const ws = U.$('#workspace');
    const cell = 10 * PX_PER_MM * v[0];
    ws.style.backgroundSize = `${cell * 5}px ${cell * 5}px, ${cell * 5}px ${cell * 5}px, ${cell}px ${cell}px, ${cell}px ${cell}px`;
    ws.style.backgroundPosition = `${v[4]}px ${v[5]}px`;
    U.$('#zoomLabel').textContent = Math.round(v[0] * 100) + '%';
    B.canvas.getObjects().forEach(syncTextPadding);
    B.canvas.requestRenderAll();
  }

  B.fit = () => {
    if (!B.canvas) return;
    const ws = U.$('#workspace');
    if (ws.clientWidth && (ws.clientWidth !== B.canvas.width || ws.clientHeight !== B.canvas.height)) {
      B.canvas.setDimensions({ width: ws.clientWidth, height: ws.clientHeight });
    }
    const W = B.canvas.width, H = B.canvas.height, p = B.paper;
    const z = U.clamp(Math.min((W - 80) / p.w, (H - 80) / p.h), 0.03, 8);
    setVpt(z, (W - p.w * z) / 2, (H - p.h * z) / 2);
  };

  B.zoomAt = (factor, cx, cy) => {
    const v = B.canvas.viewportTransform;
    if (cx == null) { cx = B.canvas.width / 2; cy = B.canvas.height / 2; }
    const z = U.clamp(v[0] * factor, 0.03, 12);
    const k = z / v[0];
    setVpt(z, cx - (cx - v[4]) * k, cy - (cy - v[5]) * k);
  };

  B.panBy = (dx, dy) => {
    const v = B.canvas.viewportTransform;
    setVpt(v[0], v[4] + dx, v[5] + dy);
  };

  B.spaceDown = false;
  function setupNavigation(ws) {
    let pan = null;
    ws.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && B.spaceDown)) {
        e.preventDefault();
        e.stopPropagation();
        pan = { x: e.clientX, y: e.clientY };
        ws.classList.add('panning');
      }
    }, true);
    window.addEventListener('mousemove', (e) => {
      if (!pan) return;
      B.panBy(e.clientX - pan.x, e.clientY - pan.y);
      pan = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => {
      if (pan) { pan = null; ws.classList.remove('panning'); }
    });
    ws.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        const r = ws.getBoundingClientRect();
        B.zoomAt(Math.exp(-e.deltaY * k * 0.0025 * (e.ctrlKey && !Number.isInteger(e.deltaY) ? 4 : 1)), e.clientX - r.left, e.clientY - r.top);
      } else if (e.shiftKey && !e.deltaX) {
        B.panBy(-e.deltaY * k, 0);
      } else {
        B.panBy(-e.deltaX * k, -e.deltaY * k);
      }
    }, { passive: false });
  }

  B.setSpace = (down) => {
    B.spaceDown = down;
    U.$('#workspace').classList.toggle('space-pan', down);
    B.canvas.skipTargetFind = down;
    B.canvas.selection = !down;
  };

  /* ---------- Canvas events ---------- */
  function setupEvents() {
    const c = B.canvas;
    c.on('object:modified', (e) => {
      const t = e.target;
      if (t && t.kind === 'text' && !t.group) bakeTextScale(t);
      if (t) updateClips(t);
      B.commit();
    });
    c.on('object:rotating', (e) => {
      if (e.e && e.e.shiftKey) e.target.set('angle', Math.round(e.target.angle / 15) * 15);
    });
    c.on('object:scaling', (e) => syncTextPadding(e.target));
    c.on('text:changed', (e) => CC.emit('text-live', e.target));
    c.on('text:editing:exited', (e) => {
      const t = e.target;
      if (t && !t.text.trim()) {
        c.remove(t);
        CC.emit('selection');
      }
      B.commit();
    });
    const sel = () => CC.emit('selection');
    c.on('selection:created', sel);
    c.on('selection:updated', sel);
    c.on('selection:cleared', sel);
    c.on('mouse:dblclick', (e) => {
      if (e.target && e.target.kind === 'cut' && !e.target.locked) CC.app.reEditCut(e.target);
    });
  }

  /* A piece trimmed to a page follows its centre when it's dragged onto the other page of a spread. */
  B.pageIndexAt = (x, y, p = B.paper) => (p.pages || []).findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  B.objCenter = (o) => {
    const c = o.getCenterPoint();
    return o.group ? fabric.util.transformPoint(c, o.group.calcTransformMatrix()) : c;
  };
  function updateClips(t) {
    const p = B.paper;
    if (!p.pages || p.pages.length < 2) return;
    const objs = t.type === 'activeSelection' ? t.getObjects() : [t];
    for (const o of objs) {
      if (o.clip == null) continue;
      const c = B.objCenter(o);
      const i = B.pageIndexAt(c.x, c.y);
      if (i >= 0) o.clip = i;
    }
  }

  function bakeTextScale(t) {
    const s = t.scaleX;
    if (Math.abs(s - 1) < 1e-4 || Math.abs(t.scaleX - t.scaleY) > 1e-4) return;
    t.set({ fontSize: U.round(t.fontSize * s, 2), strokeWidth: U.round(t.strokeWidth * s, 2), scaleX: 1, scaleY: 1 });
    t.setCoords();
    syncTextPadding(t);
  }

  function syncTextPadding(o) {
    if (!o || o.kind !== 'text') return;
    o.padding = o.boxPadPx() * Math.abs(o.scaleX) * B.canvas.getZoom();
    o.setCoords();
  }
  B.syncTextPadding = syncTextPadding;

  /* ---------- Object factories ---------- */
  const SIDE_CONTROLS_OFF = { ml: false, mr: false, mt: false, mb: false };

  B.applyLock = (o, locked) => {
    o.locked = !!locked;
    o.set({
      selectable: !locked,
      evented: !locked,
      lockMovementX: !!locked,
      lockMovementY: !!locked,
      lockScalingX: !!locked,
      lockScalingY: !!locked,
      lockRotation: !!locked,
      hasControls: !locked,
    });
  };

  /* Bitmap for a piece: the plain cut-out, or the cut-out with its sticker border. */
  const pieceBitmap = (cutId, sticker) =>
    sticker && sticker.px > 0 ? CC.cuts.stickerEntry(cutId, sticker.px, sticker.color) || CC.cuts.entry(cutId) : CC.cuts.entry(cutId);

  // Soft "lifted sticker" shadow. Fabric shadow units are screen-independent, so scale by the piece size.
  function applyStickerShadow(o) {
    o.shadow = o.sticker && o.sticker.shadow
      ? new fabric.Shadow({ color: 'rgba(0,0,0,0.28)', blur: 10, offsetX: 0, offsetY: 3, nonScaling: true })
      : null;
  }

  B.makeCutPiece = (cutId, props = {}) => {
    const sticker = props.sticker || null;
    const e = pieceBitmap(cutId, sticker);
    if (!e) return null;
    const cut = CC.cuts.get(cutId);
    const o = new fabric.Image(e.canvas, { ...props });
    o._mips = e.mips;
    o.sticker = sticker;
    applyStickerShadow(o);
    o.kind = 'cut';
    o.cutId = cutId;
    o.sourceId = cut.sourceId;
    o.uid = props.uid || U.uid('obj');
    o.name = props.name || (CC.sources.get(cut.sourceId) || {}).name || 'Cut-out';
    o.setControlsVisibility(SIDE_CONTROLS_OFF);
    B.applyLock(o, props.locked);
    return o;
  };

  B.TEXT_DEFAULTS = {
    fontFamily: 'Caveat',
    fontSize: 72,
    fontWeight: 'normal',
    fontStyle: 'normal',
    fill: '#1d1d1f',
    textAlign: 'left',
    lineHeight: 1.1,
    charSpacing: 0,
    stroke: '#ffffff',
    strokeWidth: 0,
    boxColor: '',
    boxPad: 0.25,
    boxRadius: 0.15,
  };

  B.makeText = (text, props = {}) => {
    const o = new fabric.CollageText(text, {
      ...B.TEXT_DEFAULTS,
      ...props,
      paintFirst: 'stroke',
      strokeLineJoin: 'round',
      editingBorderColor: ACCENT,
      cursorColor: ACCENT,
      cursorWidth: 2,
      selectionColor: 'rgba(228,87,46,0.25)',
    });
    o.kind = 'text';
    o.uid = props.uid || U.uid('obj');
    o.name = props.name || '';
    o.setControlsVisibility(SIDE_CONTROLS_OFF);
    B.applyLock(o, props.locked);
    syncTextPadding(o);
    return o;
  };

  B.displayName = (o) => (o.kind === 'text' ? o.name || (o.text || '').split('\n')[0].slice(0, 40) || 'Text' : o.name || 'Cut-out');

  /* ---------- Serialisation ---------- */
  const r2 = (v) => U.round(v, 3);
  B.serializeObj = (o) => {
    const base = {
      uid: o.uid, kind: o.kind, name: o.name || '',
      left: r2(o.left), top: r2(o.top), scaleX: r2(o.scaleX), scaleY: r2(o.scaleY), angle: r2(o.angle),
      flipX: !!o.flipX, flipY: !!o.flipY, opacity: r2(o.opacity), visible: o.visible !== false, locked: !!o.locked,
    };
    if (o.clip != null) base.clip = o.clip;
    if (o.kind === 'cut') {
      base.cutId = o.cutId;
      if (o.sticker) base.sticker = { ...o.sticker };
    }
    if (o.kind === 'text') {
      for (const k of Object.keys(B.TEXT_DEFAULTS)) base[k] = o[k];
      base.text = o.text;
    }
    return base;
  };

  B.deserializeObj = (d) => {
    const props = { ...d };
    delete props.kind;
    delete props.cutId;
    if (d.kind === 'cut') return B.makeCutPiece(d.cutId, props);
    if (d.kind === 'text') {
      delete props.text;
      return B.makeText(d.text, props);
    }
    return null;
  };

  /* Multi-selections hold objects in group-relative coordinates; flatten while serialising. */
  B.withPlainSelection = (fn) => {
    const c = B.canvas;
    const a = c.getActiveObject();
    if (!a || a.type !== 'activeSelection') return fn();
    const objs = a.getObjects();
    c._discardActiveObject(); // silent variants: no selection events
    try {
      return fn();
    } finally {
      const sel = new fabric.ActiveSelection(objs, { canvas: c });
      c._setActiveObject(sel);
      c.requestRenderAll();
    }
  };

  B.getState = () =>
    B.withPlainSelection(() => ({
      paper: clone(B.paper),
      objects: B.canvas.getObjects().map(B.serializeObj),
    }));

  B.restore = (state, { keepSelection = true } = {}) => {
    const c = B.canvas;
    B.restoring = true;
    const selUids = keepSelection ? B.selected().map((o) => o.uid) : [];
    const prevPaper = B.paper;
    c.discardActiveObject();
    c.renderOnAddRemove = false;
    c.remove(...c.getObjects());
    B.paper = { ...DEFAULT_PAPER, ...clone(state.paper || {}) };
    let missing = 0;
    for (const d of state.objects || []) {
      const o = B.deserializeObj(d);
      if (o) c.add(o);
      else missing++;
    }
    c.renderOnAddRemove = true;
    const reselect = c.getObjects().filter((o) => selUids.includes(o.uid) && o.selectable);
    if (reselect.length === 1) c.setActiveObject(reselect[0]);
    else if (reselect.length > 1) c.setActiveObject(new fabric.ActiveSelection(reselect, { canvas: c }));
    if (prevPaper.w !== B.paper.w || prevPaper.h !== B.paper.h) B.fit();
    syncView();
    B.restoring = false;
    CC.emit('change', { restored: true });
    CC.emit('selection');
    if (missing) U.toast(`${missing} piece${missing > 1 ? 's' : ''} couldn’t be restored (photo missing)`, 'warn');
  };

  /* ---------- History ---------- */
  const H = { stack: [], idx: -1, max: 150 };
  B.commit = () => {
    if (B.restoring || !B.ready) return;
    const s = JSON.stringify(B.getState());
    if (s === H.stack[H.idx]) return;
    H.stack.splice(H.idx + 1);
    H.stack.push(s);
    if (H.stack.length > H.max) H.stack.shift();
    H.idx = H.stack.length - 1;
    CC.emit('change', {});
  };
  B.resetHistory = () => {
    H.stack = [JSON.stringify(B.getState())];
    H.idx = 0;
    CC.emit('change', {});
  };
  // Each zine page / the collage keeps its own undo history while you switch between them.
  B.getHistory = () => ({ stack: H.stack.slice(), idx: H.idx });
  B.setHistory = (h) => {
    if (!h || !h.stack || !h.stack.length) return B.resetHistory();
    H.stack = h.stack.slice();
    H.idx = U.clamp(h.idx, 0, H.stack.length - 1);
    CC.emit('change', {});
  };
  B.historyStrings = () => H.stack;
  B.canUndo = () => H.idx > 0;
  B.canRedo = () => H.idx < H.stack.length - 1;
  B.undo = () => {
    exitEditing();
    if (!B.canUndo()) return;
    H.idx--;
    B.restore(JSON.parse(H.stack[H.idx]));
  };
  B.redo = () => {
    exitEditing();
    if (!B.canRedo()) return;
    H.idx++;
    B.restore(JSON.parse(H.stack[H.idx]));
  };

  function exitEditing() {
    const a = B.canvas.getActiveObject();
    if (a && a.isEditing) a.exitEditing();
  }
  B.exitEditing = exitEditing;

  /* ---------- Queries ---------- */
  B.selected = () => {
    const a = B.canvas && B.canvas.getActiveObject();
    if (!a) return [];
    return a.type === 'activeSelection' ? a.getObjects() : [a];
  };
  B.byUid = (uid) => B.canvas.getObjects().find((o) => o.uid === uid);
  B.usedCutIds = () => new Set(B.canvas.getObjects().filter((o) => o.kind === 'cut').map((o) => o.cutId));
  B.countBySource = () => {
    const m = new Map();
    for (const o of B.canvas.getObjects()) if (o.kind === 'cut') m.set(o.sourceId, (m.get(o.sourceId) || 0) + 1);
    return m;
  };
  /* Paper-space point at the centre of the visible area, kept on the paper. */
  B.viewCenter = () => {
    const v = B.canvas.viewportTransform;
    const x = (B.canvas.width / 2 - v[4]) / v[0], y = (B.canvas.height / 2 - v[5]) / v[0];
    return { x: U.clamp(x, 0, B.paper.w), y: U.clamp(y, 0, B.paper.h) };
  };

  /* ---------- Actions ---------- */
  B.select = (objs) => {
    const c = B.canvas;
    c.discardActiveObject();
    if (objs.length === 1) c.setActiveObject(objs[0]);
    else if (objs.length > 1) c.setActiveObject(new fabric.ActiveSelection(objs, { canvas: c }));
    c.requestRenderAll();
  };

  /* Place a new cut-out. Pieces land where they sat in the photo, with the photo scaled to fit the
     visible paper — so several pieces cut from one photo keep their relative positions. */
  B.addCut = (cut) => {
    const e = CC.cuts.entry(cut.id);
    const src = CC.sources.get(cut.sourceId);
    if (!e || !src) {
      U.toast('Nothing to place — draw a shape around part of the photo first', 'warn');
      return null;
    }
    const ctr = B.viewCenter();
    // on a zine spread, size the photo to the page you're looking at
    const pi = B.pageIndexAt(ctr.x, ctr.y);
    const p = pi >= 0 ? B.paper.pages[pi] : B.paper;
    const s = Math.min((p.w * 0.85) / src.w, (p.h * 0.85) / src.h);
    const o = B.makeCutPiece(cut.id, {
      left: ctr.x + (e.box.x + e.box.w / 2 - src.w / 2) * s,
      top: ctr.y + (e.box.y + e.box.h / 2 - src.h / 2) * s,
      scaleX: s,
      scaleY: s,
    });
    B.canvas.add(o);
    B.select([o]);
    B.commit();
    return o;
  };

  /* Swap a piece's cut for an edited one, keeping the photo content exactly where it was. */
  B.replaceCut = (o, cut) => {
    const oldE = CC.cuts.entry(o.cutId);
    const e = CC.cuts.entry(cut.id);
    if (!e) {
      U.toast('The edited cut is empty — piece left unchanged', 'warn');
      return;
    }
    B.withPlainSelection(() => {
      const d = new fabric.Point(
        e.box.x + e.box.w / 2 - (oldE.box.x + oldE.box.w / 2),
        e.box.y + e.box.h / 2 - (oldE.box.y + oldE.box.h / 2)
      );
      const p = fabric.util.transformPoint(d, o.calcTransformMatrix());
      const b = pieceBitmap(cut.id, o.sticker) || e;
      o.setElement(b.canvas);
      o._mips = b.mips;
      o.cutId = cut.id;
      o.set({ left: p.x, top: p.y });
      o.setCoords();
    });
    B.canvas.requestRenderAll();
    B.commit();
  };

  /* Turn the die-cut sticker border on/off or change it. sticker = { px (cut-out pixels), color } | null */
  B.setSticker = (o, sticker) => {
    if (!o || o.kind !== 'cut') return;
    const s = sticker && sticker.px > 0 ? { px: U.round(sticker.px, 1), color: sticker.color || '#ffffff', shadow: !!sticker.shadow } : null;
    const e = pieceBitmap(o.cutId, s);
    if (!e) return;
    o.sticker = s;
    applyStickerShadow(o);
    o.setElement(e.canvas);
    o._mips = e.mips;
    o.setCoords();
    B.canvas.requestRenderAll();
    B.commit();
  };

  B.addText = () => {
    const ctr = B.viewCenter();
    const size = Math.round(Math.max(24, Math.min(B.paper.w, B.paper.h) * 0.08));
    const o = B.makeText('Your text', { left: ctr.x, top: ctr.y, fontSize: size, ...(B.lastTextStyle || {}) });
    B.canvas.add(o);
    B.select([o]);
    o.enterEditing();
    o.selectAll();
    B.commit();
  };

  B.deleteSelected = () => {
    const objs = B.selected();
    if (!objs.length) return;
    exitEditing();
    B.canvas.discardActiveObject();
    B.canvas.remove(...objs);
    B.canvas.requestRenderAll();
    B.commit();
  };

  B.duplicateSelected = () => {
    const objs = B.selected();
    if (!objs.length) return;
    exitEditing();
    const data = B.withPlainSelection(() => objs.map(B.serializeObj));
    const off = 18 / B.zoom();
    const copies = data.map((d) => B.deserializeObj({ ...d, uid: U.uid('obj'), left: d.left + off, top: d.top + off, locked: false })).filter(Boolean);
    const c = B.canvas;
    if (copies.length === 1) c.insertAt(copies[0], c.getObjects().indexOf(objs[0]) + 1);
    else copies.forEach((o) => c.add(o));
    B.select(copies);
    B.commit();
  };

  B.arrange = (how) => {
    const a = B.canvas.getActiveObject();
    if (!a) return;
    const c = B.canvas;
    if (how === 'toFront') c.bringToFront(a);
    else if (how === 'toBack') c.sendToBack(a);
    else if (how === 'forward') c.bringForward(a);
    else if (how === 'backward') c.sendBackwards(a);
    c.requestRenderAll();
    B.commit();
  };

  B.moveToIndex = (o, idx) => {
    B.canvas.moveTo(o, idx);
    B.canvas.requestRenderAll();
    B.commit();
  };

  B.flip = (axis) => {
    const objs = B.selected();
    if (!objs.length) return;
    const a = B.canvas.getActiveObject();
    const key = axis === 'x' ? 'flipX' : 'flipY';
    a.set(key, !a[key]);
    B.canvas.requestRenderAll();
    B.commit();
  };

  B.nudge = (dx, dy) => {
    const a = B.canvas.getActiveObject();
    if (!a || a.lockMovementX) return;
    a.set({ left: a.left + dx, top: a.top + dy });
    a.setCoords();
    B.canvas.requestRenderAll();
    nudgeCommit();
  };
  const nudgeCommit = U.debounce(() => B.commit(), 400);

  B.selectAll = () => {
    const objs = B.canvas.getObjects().filter((o) => o.selectable && o.visible !== false);
    B.select(objs);
  };

  B.clear = () => {
    exitEditing();
    B.canvas.discardActiveObject();
    B.canvas.remove(...B.canvas.getObjects());
    B.canvas.requestRenderAll();
  };

  /* ---------- Offscreen rendering ----------
     Draw any saved state ({paper, objects}) to a new canvas at `scale` — used for zine thumbnails,
     the printed-sheet view, the flip-through preview and zine export. */
  let R = null;
  B.renderState = (state, scale) => {
    if (!R) {
      R = new fabric.StaticCanvas(null, { enableRetinaScaling: false, renderOnAddRemove: false });
      R.isRenderer = true;
      R._renderBackground = drawPaper;
      R._renderOverlay = drawOverlay;
    }
    const p = { ...DEFAULT_PAPER, ...state.paper };
    R.paperState = p;
    const objs = (state.objects || []).map((d) => B.deserializeObj(d)).filter(Boolean);
    if (objs.length) R.add(...objs);
    try {
      return R.toCanvasElement(scale, { left: 0, top: 0, width: p.w, height: p.h });
    } finally {
      if (objs.length) R.remove(...objs);
      R.paperState = null;
    }
  };

  /* ---------- Export rendering ---------- */
  B.renderExport = (scale, { transparent = false } = {}) => {
    const c = B.canvas;
    exitEditing();
    const vpt = c.viewportTransform.slice();
    const sel = B.selected();
    c.discardActiveObject();
    B.exporting = { transparent };
    c.viewportTransform = [1, 0, 0, 1, 0, 0];
    let el;
    try {
      el = c.toCanvasElement(scale, { left: 0, top: 0, width: B.paper.w, height: B.paper.h });
    } finally {
      B.exporting = null;
      c.setViewportTransform(vpt);
      if (sel.length) B.select(sel);
      c.requestRenderAll();
    }
    return el;
  };
})(window.CC);
