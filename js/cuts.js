'use strict';
/* Registry of cuts (immutable cut definitions, shared by id) and a cache of rendered cut-out bitmaps.
   Board objects and undo snapshots reference cuts by id, so history snapshots stay tiny. */
(function (CC) {
  const U = CC.util;
  const C = (CC.cuts = { reg: new Map(), cache: new Map() });

  C.add = (cut) => {
    const c = { id: cut.id || U.uid('cut'), sourceId: cut.sourceId, ops: cut.ops, smooth: cut.smooth || 0, feather: cut.feather || 0 };
    C.reg.set(c.id, c);
    return c;
  };
  C.get = (id) => C.reg.get(id);

  C.entry = (id) => {
    let e = C.cache.get(id);
    if (e) {
      e.used = performance.now();
      return e;
    }
    const cut = C.reg.get(id);
    const src = cut && CC.sources.get(cut.sourceId);
    if (!cut || !src) return null;
    const r = CC.geo.renderCut(src.img, cut);
    if (!r) return null;
    e = { canvas: r.canvas, box: r.box, mips: CC.geo.buildMips(r.canvas), thumb: null, used: performance.now() };
    C.cache.set(id, e);
    evict();
    return e;
  };

  /* The cut-out with a die-cut sticker border (r in cut-out pixels). Cached per cut/size/colour. */
  C.stickerEntry = (id, r, color) => {
    const key = `${id}|sticker|${Math.round(r * 10) / 10}|${color}`;
    let e = C.cache.get(key);
    if (e) {
      e.used = performance.now();
      return e;
    }
    const base = C.entry(id);
    if (!base) return null;
    const s = CC.geo.renderSticker(base.canvas, r, color);
    e = { canvas: s.canvas, box: base.box, pad: s.pad, mips: CC.geo.buildMips(s.canvas), used: performance.now() };
    C.cache.set(key, e);
    evict();
    return e;
  };

  C.thumbURL = (id) => {
    const e = C.entry(id);
    if (!e) return '';
    if (!e.thumb) {
      const level = [...e.mips].reverse().find((m) => Math.max(m.width, m.height) >= 64) || e.mips[0];
      const k = Math.min(1, 64 / Math.max(level.width, level.height));
      const c = U.canvas(level.width * k, level.height * k);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(level, 0, 0, c.width, c.height);
      e.thumb = c.toDataURL('image/png');
    }
    return e.thumb;
  };

  function evict() {
    if (C.cache.size <= 40) return;
    const inUse = CC.board && CC.board.ready ? CC.board.usedCutIds() : new Set();
    const victims = [...C.cache.entries()].filter(([id]) => !inUse.has(id.split('|')[0])).sort((a, b) => a[1].used - b[1].used);
    for (const [id] of victims.slice(0, C.cache.size - 30)) C.cache.delete(id);
  }

  C.serialize = (ids) => {
    const out = {};
    for (const id of ids) {
      const c = C.reg.get(id);
      if (c) out[id] = c;
    }
    return out;
  };
  C.load = (obj) => {
    for (const [id, c] of Object.entries(obj || {})) C.reg.set(id, { ...c, id });
  };
  C.clear = () => {
    C.reg.clear();
    C.cache.clear();
  };
})(window.CC);
