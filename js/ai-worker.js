'use strict';
/* Source of the AI Web Worker. The function below is stringified and started from a Blob URL, which
   works even when index.html is opened straight from disk (file://).

   On first use it downloads transformers.js, the ONNX runtime and two models, and stores every file
   in IndexedDB ('ai' store), so afterwards everything runs offline:
     - D-FINE small (COCO object detector, Apache-2.0)           → "what objects are in this photo?"
     - SAM 2.1 tiny  (Segment Anything 2, Apache-2.0)            → precise outline for a box or a click
   Nothing here touches the DOM; the main thread sends pixels and gets masks back. */
(function (CC) {
  CC.aiWorkerMain = function () {
    const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
    const DET = { id: 'onnx-community/dfine_s_coco-ONNX', revision: 'a3cf03147a9b86c78475139115c8ac142577352d', dtype: 'uint8' };
    const SAM = { id: 'onnx-community/sam2.1-hiera-tiny-ONNX', revision: '814a066640debee5a91e70aa401fb8e17e030503', dtype: 'uint8' };

    let T = null, detector = null, sam = null, samProc = null;
    const images = new Map(); // photo id → { raw, inputs, emb }  (most recent last)

    /* ---------- IndexedDB file cache (same database as the app) ---------- */
    let dbP = null;
    function db() {
      if (!dbP) {
        dbP = new Promise((res) => {
          try {
            const r = indexedDB.open('collage-cutter', 2);
            r.onupgradeneeded = () => {
              const d = r.result;
              if (!d.objectStoreNames.contains('sources')) d.createObjectStore('sources', { keyPath: 'id' });
              if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
              if (!d.objectStoreNames.contains('ai')) d.createObjectStore('ai');
            };
            r.onsuccess = () => res(r.result);
            r.onerror = () => res(null);
          } catch (e) {
            res(null);
          }
        });
      }
      return dbP;
    }
    async function idb(mode, fn) {
      const d = await db();
      if (!d) return undefined;
      return new Promise((res) => {
        try {
          const q = fn(d.transaction('ai', mode).objectStore('ai'));
          q.onsuccess = () => res(q.result);
          q.onerror = () => res(undefined);
        } catch (e) {
          res(undefined);
        }
      });
    }
    const idbGet = (key) => idb('readonly', (s) => s.get(key));
    const idbPut = (key, val) => idb('readwrite', (s) => s.put(val, key));

    const post = (msg, transfer) => self.postMessage(msg, transfer || []);
    const progress = (file, loaded, total) => post({ type: 'progress', file, loaded, total });

    async function fetchCached(url) {
      const hit = await idbGet(url);
      if (hit) return hit;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        progress(url, loaded, total);
      }
      const blob = new Blob(chunks);
      await idbPut(url, blob);
      return blob;
    }
    const blobURL = (blob, type) => URL.createObjectURL(new Blob([blob], { type }));

    /* ---------- Setup ---------- */
    async function init() {
      if (sam) return;
      const lib = await fetchCached(CDN + 'transformers.min.js');
      const mjs = await fetchCached(CDN + 'ort-wasm-simd-threaded.jsep.mjs');
      const wasm = await fetchCached(CDN + 'ort-wasm-simd-threaded.jsep.wasm');
      T = await import(blobURL(lib, 'text/javascript'));
      const onnx = T.env.backends.onnx;
      onnx.wasm.wasmPaths = { mjs: blobURL(mjs, 'text/javascript'), wasm: blobURL(wasm, 'application/wasm') };
      // Multi-threading needs a cross-origin-isolated page (start.sh provides that); otherwise 1 thread.
      onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;
      T.env.allowLocalModels = false;
      T.env.useBrowserCache = false;
      T.env.useCustomCache = true;
      T.env.customCache = {
        async match(key) {
          const b = await idbGet(String(key));
          return b ? new Response(b, { headers: { 'content-length': String(b.size) } }) : undefined;
        },
        async put(key, response) {
          await idbPut(String(key), await response.blob());
        },
      };
      const opts = (m) => ({
        dtype: m.dtype,
        device: 'wasm',
        revision: m.revision,
        progress_callback: (p) => {
          if (p.status === 'progress') progress(`${p.name}/${p.file}`, p.loaded, p.total);
        },
      });
      detector = await T.pipeline('object-detection', DET.id, opts(DET));
      samProc = await T.AutoProcessor.from_pretrained(SAM.id, opts(SAM));
      sam = await T.Sam2Model.from_pretrained(SAM.id, opts(SAM));
      await idbPut('__installed', { at: Date.now(), det: DET, sam: SAM });
      return { threads: onnx.wasm.numThreads };
    }

    /* ---------- Inference ---------- */
    async function encode(id, rgba, w, h) {
      const raw = new T.RawImage(new Uint8ClampedArray(rgba), w, h, 4).rgb();
      const inputs = await samProc(raw);
      const emb = await sam.get_image_embeddings(inputs);
      images.delete(id);
      images.set(id, { raw, inputs, emb });
      while (images.size > 3) images.delete(images.keys().next().value);
    }

    function image(id) {
      const im = images.get(id);
      if (!im) throw new Error('NOT_ENCODED');
      return im;
    }

    // SAM returns 3 candidate masks per prompt; copy them out as plain byte arrays
    async function masksFor(im, prompt) {
      const out = await sam({ ...im.emb, ...prompt });
      const masks = await samProc.post_process_masks(out.pred_masks, im.inputs.original_sizes, im.inputs.reshaped_input_sizes);
      const m = masks[0];
      const [, n, H, W] = m.dims;
      const scores = Array.from(out.iou_scores.data).slice(0, n);
      const list = [];
      for (let k = 0; k < n; k++) list.push({ score: scores[k], mask: new Uint8Array(m.data.subarray(k * W * H, (k + 1) * W * H)) });
      return { w: W, h: H, list };
    }

    const iou = (a, b) => {
      const ix = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
      const iy = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
      const inter = ix * iy;
      const area = (r) => (r.xmax - r.xmin) * (r.ymax - r.ymin);
      return inter / (area(a) + area(b) - inter || 1);
    };

    async function detect(id) {
      const im = image(id);
      let dets = await detector(im.raw, { threshold: 0.45 });
      dets.sort((a, b) => b.score - a.score);
      const kept = [];
      for (const d of dets) {
        if (kept.some((k) => iou(k.box, d.box) > 0.7)) continue; // drop duplicates of the same thing
        kept.push(d);
        if (kept.length >= 12) break;
      }
      const ip = samProc.image_processor;
      const results = [];
      const transfer = [];
      for (const d of kept) {
        const b = d.box;
        const input_boxes = ip.reshape_input_points([[[b.xmin, b.ymin, b.xmax, b.ymax]]], im.inputs.original_sizes, im.inputs.reshaped_input_sizes, true);
        const r = await masksFor(im, { input_boxes });
        let best = 0;
        r.list.forEach((x, i) => { if (x.score > r.list[best].score) best = i; });
        results.push({ label: d.label, score: d.score, box: b, w: r.w, h: r.h, mask: r.list[best].mask });
        transfer.push(r.list[best].mask.buffer);
      }
      return { result: results, transfer };
    }

    async function point(id, x, y) {
      const im = image(id);
      const ip = samProc.image_processor;
      const input_points = ip.reshape_input_points([[[[x, y]]]], im.inputs.original_sizes, im.inputs.reshaped_input_sizes);
      const input_labels = ip.add_input_labels([[[1]]], input_points);
      const r = await masksFor(im, { input_points, input_labels });
      return { result: r, transfer: r.list.map((x) => x.mask.buffer) };
    }

    /* ---------- Message loop (one job at a time: ONNX sessions aren't re-entrant) ---------- */
    let queue = Promise.resolve();
    self.onmessage = (e) => {
      const { rid, type, ...a } = e.data;
      queue = queue.then(async () => {
        try {
          let out = { result: null, transfer: [] };
          if (type === 'init') out.result = await init();
          else if (type === 'encode') await encode(a.id, a.rgba, a.w, a.h);
          else if (type === 'detect') out = await detect(a.id);
          else if (type === 'point') out = await point(a.id, a.x, a.y);
          post({ rid, ok: true, result: out.result }, out.transfer);
        } catch (err) {
          post({ rid, ok: false, error: String((err && err.message) || err) });
        }
      });
    };
  };
})(window.CC);
