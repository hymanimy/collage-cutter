'use strict';
/* Main-thread side of the AI features. Starts the worker (js/ai-worker.js) on first use, asks before
   the one-time download, reports progress, and turns the worker's masks into ordinary cutter shapes
   (lasso outlines + subtract holes) so they can be adjusted, smoothed and re-edited like any other cut. */
(function (CC) {
  const U = CC.util, G = CC.geo;
  const A = (CC.ai = {});
  const DOWNLOAD_MB = 96;
  const MAX_SIDE = 1024; // the models work at ~1024px; sending more only costs time

  let worker = null, readyP = null, isReady = false, installedAtStart = false, rid = 0;
  const pending = new Map();
  const files = new Map();
  const encoded = new Map(); // photo id → Promise<{k}>
  const detections = new Map(); // photo id → Promise<candidates>

  A.onStatus = null; // set by the cutter: (text|null, fraction|null) => void
  const setStatus = (text, frac = null) => A.onStatus && A.onStatus(text, frac);
  A.isReady = () => isReady;

  const LABELS = { tvmonitor: 'TV', pottedplant: 'potted plant', diningtable: 'table', 'cell phone': 'phone', 'hair drier': 'hair dryer', aeroplane: 'plane', motorbike: 'motorbike', sofa: 'sofa' };
  A.prettyLabel = (l) => {
    const s = LABELS[l] || l;
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  function startWorker() {
    const src = `(${CC.aiWorkerMain.toString()})();`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        files.set(m.file, m);
        if (!installedAtStart) reportProgress();
        return;
      }
      const p = pending.get(m.rid);
      if (!p) return;
      pending.delete(m.rid);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'The AI helper failed to start');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
  }

  function call(type, data = {}, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++rid;
      pending.set(id, { resolve, reject });
      worker.postMessage({ rid: id, type, ...data }, transfer);
    });
  }

  function reportProgress() {
    let loaded = 0, total = 0;
    for (const f of files.values()) {
      loaded += f.loaded || 0;
      total += f.total || f.loaded || 0;
    }
    const frac = Math.min(1, loaded / Math.max(total, DOWNLOAD_MB * 1e6));
    setStatus(`Downloading AI models… ${Math.round(loaded / 1e6)} of ~${DOWNLOAD_MB} MB (one time only)`, frac);
  }

  A.isInstalled = async () => !!(await CC.db.aiGet('__installed').catch(() => null));

  /* Load the models (asking before the first download). Rejects with 'cancelled' if the user says no. */
  A.ensure = async () => {
    if (readyP) return readyP;
    const installed = await A.isInstalled();
    if (!installed) {
      if (!navigator.onLine) throw new Error('You’re offline. The AI models need a one-time download first.');
      const ok = await U.confirm({
        title: 'Download the AI models?',
        message: `Find objects and Magic select need about ${DOWNLOAD_MB} MB of AI models. They download once, are stored in this browser, and then work offline. Your photos never leave your computer.`,
        ok: 'Download',
      });
      if (!ok) throw new Error('cancelled');
    }
    installedAtStart = installed;
    readyP = (async () => {
      files.clear();
      startWorker();
      setStatus(installed ? 'Loading AI models…' : `Downloading AI models… 0 of ~${DOWNLOAD_MB} MB (one time only)`, installed ? null : 0);
      try {
        const info = await call('init');
        A.threads = info && info.threads;
        isReady = true;
        CC.emit('ai-installed');
      } finally {
        setStatus(null);
      }
    })();
    readyP.catch(() => {
      readyP = null;
      isReady = false;
      if (worker) worker.terminate();
      worker = null;
    });
    return readyP;
  };

  function pixels(src) {
    const k = Math.max(1, Math.max(src.w, src.h) / MAX_SIDE);
    const w = Math.round(src.w / k), h = Math.round(src.h / k);
    const c = U.canvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(src.img, 0, 0, w, h);
    return { rgba: x.getImageData(0, 0, w, h).data.buffer, w, h, k: src.w / w };
  }

  /* Run the heavy image analysis once per photo; clicks and boxes afterwards are fast. */
  A.encode = (src) => {
    let p = encoded.get(src.id);
    if (!p) {
      p = (async () => {
        await A.ensure();
        const px = pixels(src);
        setStatus('Analysing photo…');
        try {
          await call('encode', { id: src.id, rgba: px.rgba, w: px.w, h: px.h }, [px.rgba]);
        } finally {
          setStatus(null);
        }
        return { k: px.k };
      })();
      encoded.set(src.id, p);
      p.catch(() => encoded.delete(src.id));
      while (encoded.size > 3) encoded.delete(encoded.keys().next().value); // worker keeps 3 too
    }
    return p;
  };
  A.isEncoded = (src) => encoded.has(src.id);

  async function withEncoding(src, fn) {
    const enc = await A.encode(src);
    try {
      return await fn(enc);
    } catch (e) {
      if (e.message !== 'NOT_ENCODED') throw e;
      encoded.delete(src.id);
      return fn(await A.encode(src));
    }
  }

  /* Detected objects → [{ id, label, score, ops, bounds }] in photo pixel coordinates. */
  A.detect = (src) => {
    let p = detections.get(src.id);
    if (!p) {
      p = withEncoding(src, async () => {
        setStatus('Finding objects…');
        try {
          const res = await call('detect', { id: src.id });
          return res
            .map((d, i) => {
              const k = src.w / d.w;
              const ops = G.maskToOps(d.mask, d.w, d.h, k);
              return { id: 'cand' + i, label: A.prettyLabel(d.label), score: d.score, ops };
            })
            .filter((c) => c.ops.some((o) => o.mode === 'add'));
        } finally {
          setStatus(null);
        }
      });
      detections.set(src.id, p);
      p.catch(() => detections.delete(src.id));
    }
    return p;
  };

  /* Magic select: SAM's 3 guesses for the object under (x, y), smallest first. */
  A.point = (src, x, y) =>
    withEncoding(src, async (enc) => {
      const r = await call('point', { id: src.id, x: x / enc.k, y: y / enc.k });
      const k = src.w / r.w;
      return r.list
        .map((m) => {
          let area = 0;
          for (let i = 0; i < m.mask.length; i++) area += m.mask[i];
          return { score: m.score, area, ops: G.maskToOps(m.mask, r.w, r.h, k) };
        })
        .filter((a) => a.area > 0 && a.ops.some((o) => o.mode === 'add'))
        .sort((a, b) => a.area - b.area);
    });

  A.clear = async () => {
    if (worker) worker.terminate();
    worker = null;
    readyP = null;
    isReady = false;
    encoded.clear();
    detections.clear();
    await CC.db.aiClear();
  };
})(window.CC);
