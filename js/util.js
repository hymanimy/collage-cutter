'use strict';
/* Shared helpers: DOM, icons, dialogs, toasts, files. Everything hangs off window.CC. */
window.CC = window.CC || {};
(function (CC) {
  const U = (CC.util = {});

  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.round = (v, d = 2) => { const m = 10 ** d; return Math.round(v * m) / m; };
  U.debounce = (fn, ms) => {
    let t;
    const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    f.flush = (...a) => { clearTimeout(t); fn(...a); };
    return f;
  };
  U.rafThrottle = (fn) => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    };
  };
  U.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* App-wide event bus */
  CC.bus = new EventTarget();
  CC.emit = (name, detail) => CC.bus.dispatchEvent(new CustomEvent(name, { detail }));
  CC.on = (name, fn) => CC.bus.addEventListener(name, (e) => fn(e.detail));

  /* ---------- Icons (24px stroke icons) ---------- */
  const ICONS = {
    scissors: 'M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
    filePlus: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6',
    folder: 'M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
    undo: 'M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
    redo: 'M21 7v6h-6M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7',
    imagePlus: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7M16 5h6M19 2v6M21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21M9 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM21 15l-5-5L5 21M8.5 8.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
    type: 'M4 7V4h16v3M9 20h6M12 4v16',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    fit: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
    x: 'M18 6 6 18M6 6l12 12',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
    copy: 'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4',
    eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    eyeOff: 'M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20',
    lock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
    unlock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 9.9-1',
    flipH: 'M12 3v18M16 7l4 5-4 5zM8 7l-4 5 4 5z',
    flipV: 'M3 12h18M7 8l5-4 5 4zM7 16l5 4 5-4z',
    toFront: 'M5 3h14M18 13l-6-6-6 6M12 7v14',
    toBack: 'M19 21H5M6 11l6 6 6-6M12 17V3',
    chevUp: 'M18 15l-6-6-6 6',
    chevDown: 'M6 9l6 6 6-6',
    pointer: 'M4 3l7 17 2.5-7.5L21 10z',
    lasso: 'M7 22a5 5 0 0 1-2-4M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    polygon: 'M12 2.5l9 6.6-3.5 10.9h-11L3 9.1z',
    square: 'M4 4h16v16H4z',
    circle: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
    alignL: 'M3 6h18M3 12h12M3 18h16',
    alignC: 'M3 6h18M6 12h12M4 18h16',
    alignR: 'M3 6h18M9 12h12M5 18h16',
    page: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
    portrait: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    landscape: 'M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
    sticker: 'M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.5L21 14.5V5a2 2 0 0 0-2-2zM14 21v-5a2 2 0 0 1 2-2h5',
    wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
    sparkles: 'M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z',
    help: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
    layout: 'M3 4h18v16H3zM3 12h18M7.5 4v16M12 4v16M16.5 4v16',
    keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  };
  U.icon = (name, cls = '') => {
    const d = ICONS[name];
    if (!d) return '';
    const sw = name === 'grip' ? 3 : 2;
    return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  };
  U.hydrateIcons = (root = document) => {
    U.$$('[data-icon]', root).forEach((el) => {
      if (el.dataset.iconDone) return;
      el.insertAdjacentHTML('afterbegin', U.icon(el.dataset.icon));
      el.dataset.iconDone = '1';
    });
  };

  /* ---------- Toasts ---------- */
  U.toast = (msg, kind = 'info', ms = 2800) => {
    const box = U.$('#toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, ms);
  };

  /* ---------- Modals ---------- */
  U.openModal = (el) => {
    el.hidden = false;
    const close = () => { el.hidden = true; };
    U.$$('[data-close]', el).forEach((b) => (b.onclick = close));
    el.onmousedown = (e) => { if (e.target === el) close(); };
    return close;
  };
  U.confirm = ({ title, message, ok = 'OK', cancel = 'Cancel', danger = false }) =>
    new Promise((resolve) => {
      const dlg = U.$('#confirmDlg');
      U.$('#confirmTitle').textContent = title;
      U.$('#confirmMsg').textContent = message;
      const okBtn = U.$('#confirmOk');
      const cancelBtn = U.$('#confirmCancel');
      okBtn.textContent = ok;
      cancelBtn.textContent = cancel;
      okBtn.classList.toggle('danger', danger);
      dlg.hidden = false;
      const done = (v) => {
        dlg.hidden = true;
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      };
      okBtn.onclick = () => done(true);
      cancelBtn.onclick = () => done(false);
      dlg.onmousedown = (e) => { if (e.target === dlg) done(false); };
      document.addEventListener('keydown', onKey, true);
      okBtn.focus();
    });
  U.anyModalOpen = () => U.$$('.modal-backdrop').some((m) => !m.hidden);

  /* ---------- Files & images ---------- */
  U.download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  U.blobToDataURL = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  U.dataURLToBlob = async (url) => (await fetch(url)).blob();
  U.loadImage = (url) =>
    new Promise((res, rej) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not decode image'));
      img.src = url;
    });
  U.canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  U.canvasToBlob = (c, type = 'image/png', q) =>
    new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export failed — the image may be too large'))), type, q));
  U.isTyping = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  U.stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };
  U.isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  U.mod = (e) => e.ctrlKey || e.metaKey;
})(window.CC);
