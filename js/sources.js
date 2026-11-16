'use strict';
/* The photo tray: imported photos ("sources") that pieces are cut from.
   Removing a photo from the tray only hides it while pieces (or undo history) may still need it;
   hidden, unused photos are garbage-collected on the next start / new / open. */
(function (CC) {
  const U = CC.util;
  const MAX_EDGE = 4000;
  const S = (CC.sources = { map: new Map() });

  S.get = (id) => S.map.get(id);
  S.list = () => [...S.map.values()].sort((a, b) => a.added - b.added);
  S.visible = () => S.list().filter((s) => !s.hidden);

  const record = (s) => ({ id: s.id, name: s.name, blob: s.blob, w: s.w, h: s.h, hidden: !!s.hidden, added: s.added, thumbBlob: s.thumbBlob });

  async function decode(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await U.loadImage(url);
      return { url, img };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  async function makeThumb(img, alpha) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, 240 / Math.max(w, h));
    const c = U.canvas(w * k, h * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    return U.canvasToBlob(c, alpha ? 'image/png' : 'image/jpeg', 0.85);
  }

  /* Add a source from a stored record (startup / project load). */
  S.addRecord = async (rec) => {
    const { url, img } = await decode(rec.blob);
    let thumbBlob = rec.thumbBlob;
    if (!thumbBlob) thumbBlob = await makeThumb(img, /png|webp|gif/.test(rec.blob.type));
    const src = { ...rec, thumbBlob, url, img, thumbUrl: URL.createObjectURL(thumbBlob) };
    S.map.set(src.id, src);
    return src;
  };

  S.restore = async (records) => {
    for (const rec of records) {
      try {
        await S.addRecord(rec);
      } catch (e) {
        console.warn('Skipping unreadable stored photo', rec && rec.name, e);
      }
    }
    S.renderTray();
  };

  S.importBlob = async (blob, name) => {
    let { url, img } = await decode(blob);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('Empty image');
    const alpha = /png|webp|gif|avif/.test(blob.type);
    if (Math.max(w, h) > MAX_EDGE) {
      const k = MAX_EDGE / Math.max(w, h);
      const c = U.canvas(w * k, h * k);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, c.width, c.height);
      blob = await U.canvasToBlob(c, alpha ? 'image/png' : 'image/jpeg', 0.93);
      URL.revokeObjectURL(url);
      ({ url, img } = await decode(blob));
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
    const thumbBlob = await makeThumb(img, alpha);
    const src = {
      id: U.uid('src'),
      name: (name || 'Photo').replace(/\.[a-z0-9]+$/i, ''),
      blob, w, h, hidden: false, added: Date.now(), thumbBlob,
      url, img, thumbUrl: URL.createObjectURL(thumbBlob),
    };
    S.map.set(src.id, src);
    CC.db.putSource(record(src)).catch((e) => console.warn('Could not store photo', e));
    return src;
  };

  S.importFiles = async (fileList) => {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name));
    if (!files.length) {
      U.toast('No images found in what you dropped', 'warn');
      return [];
    }
    const added = [];
    for (const f of files) {
      try {
        added.push(await S.importBlob(f, f.name));
      } catch (e) {
        const heic = /\.hei[cf]$/i.test(f.name) || /hei[cf]/.test(f.type);
        U.toast(`Couldn't open ${f.name}` + (heic ? ' — browsers can’t read HEIC; export it as JPEG first' : ''), 'error', 5000);
      }
    }
    S.renderTray();
    if (added.length) U.toast(`Added ${added.length} photo${added.length > 1 ? 's' : ''} to the tray`);
    return added;
  };

  S.remove = (id) => {
    const s = S.get(id);
    if (!s) return;
    s.hidden = true;
    CC.db.putSource(record(s)).catch(() => {});
    S.renderTray();
  };

  /* Empty the tray. Photos are only hidden, so pieces cut from them can still be re-edited and undo
     still works; unused ones are cleaned up on the next start / New / Open. */
  S.removeAll = async () => {
    for (const s of S.visible()) {
      s.hidden = true;
      await CC.db.putSource(record(s)).catch(() => {});
    }
    S.renderTray();
  };

  /* Drop hidden photos no piece uses any more. */
  S.gc = (referenced) => {
    for (const s of S.list()) {
      if (s.hidden && !referenced.has(s.id)) {
        URL.revokeObjectURL(s.url);
        URL.revokeObjectURL(s.thumbUrl);
        S.map.delete(s.id);
        CC.db.deleteSource(s.id).catch(() => {});
      }
    }
  };

  S.clearAll = async () => {
    for (const s of S.map.values()) {
      URL.revokeObjectURL(s.url);
      URL.revokeObjectURL(s.thumbUrl);
    }
    S.map.clear();
    await CC.db.clearSources().catch(() => {});
  };

  S.persistAll = async () => {
    for (const s of S.map.values()) await CC.db.putSource(record(s)).catch(() => {});
  };

  /* ---------- Tray UI ---------- */
  S.renderTray = () => {
    const grid = U.$('#trayGrid');
    const vis = S.visible();
    const counts = CC.board && CC.board.ready ? CC.board.countBySource() : new Map();
    U.$('#trayEmpty').style.display = vis.length ? 'none' : '';
    U.$('#btnTrayClear').hidden = !vis.length;
    grid.innerHTML = vis
      .map((s) => {
        const n = counts.get(s.id) || 0;
        return `<div class="tcard" data-id="${s.id}" title="Click to cut out a piece">
          <div class="tthumb"><img src="${s.thumbUrl}" alt="" draggable="false"></div>
          <div class="tmeta"><span class="tname">${U.esc(s.name)}</span><span class="tdim">${s.w}×${s.h}</span></div>
          ${n ? `<span class="tbadge" title="${n} piece${n > 1 ? 's' : ''} on the paper">${n}</span>` : ''}
          <div class="tfoot">
            <button data-a="cut" title="Open the cutting window">${U.icon('scissors')}Cut out</button>
            <button data-a="whole" class="tplace" title="Put the whole photo on the paper">${U.icon('plus')}Place</button>
          </div>
          <div class="tactions">
            <button data-a="remove" title="Remove from tray">${U.icon('x')}</button>
          </div>
        </div>`;
      })
      .join('');
  };

  S.initTray = ({ onCut, onWhole }) => {
    U.$('#btnTrayClear').addEventListener('click', async () => {
      const n = S.visible().length;
      if (!n) return;
      const ok = await U.confirm({
        title: `Clear all ${n} photo${n > 1 ? 's' : ''} from the tray?`,
        message: 'Pieces you’ve already cut stay on the paper, and you can still re-edit them.',
        ok: 'Clear tray',
        danger: true,
      });
      if (!ok) return;
      await S.removeAll();
      U.toast(`Cleared ${n} photo${n > 1 ? 's' : ''} from the tray`, 'ok');
    });
    U.$('#trayGrid').addEventListener('click', async (e) => {
      const card = e.target.closest('.tcard');
      if (!card) return;
      const id = card.dataset.id;
      const a = e.target.closest('[data-a]');
      const act = a ? a.dataset.a : 'cut';
      if (act === 'cut') onCut(id);
      else if (act === 'whole') onWhole(id);
      else if (act === 'remove') {
        const n = CC.board.countBySource().get(id) || 0;
        const ok = await U.confirm({
          title: 'Remove photo from tray?',
          message: n
            ? `The ${n} piece${n > 1 ? 's' : ''} you cut from it will stay on the paper.`
            : 'You can add it again any time.',
          ok: 'Remove',
        });
        if (ok) S.remove(id);
      }
    });
  };
})(window.CC);
