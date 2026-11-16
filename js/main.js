'use strict';
/* App wiring: toolbar, drag & drop, paste, keyboard shortcuts and startup. */
(function (CC) {
  const U = CC.util;
  const B = CC.board;

  CC.app = {
    openCutter(id) {
      const src = CC.sources.get(id);
      if (!src) return;
      B.exitEditing();
      CC.cutter.open(src, { onPlace: (cut) => B.addCut(cut) });
    },
    placeWhole(id) {
      const src = CC.sources.get(id);
      if (!src) return;
      const cut = CC.cuts.add({ sourceId: id, ops: [{ type: 'rect', mode: 'add', x: 0, y: 0, w: src.w, h: src.h }], smooth: 0, feather: 0 });
      B.addCut(cut);
    },
    reEditCut(o) {
      const cut = CC.cuts.get(o.cutId);
      const src = cut && CC.sources.get(cut.sourceId);
      if (!src) {
        U.toast('The original photo for this piece is missing', 'error');
        return;
      }
      B.exitEditing();
      CC.cutter.open(src, { cut, onPlace: (newCut) => B.replaceCut(o, newCut) });
    },
    async importFiles(files) {
      const added = await CC.sources.importFiles(files);
      if (added.length === 1) CC.app.openCutter(added[0].id);
    },
    async newCollage() {
      if (B.canvas.getObjects().length) {
        const ok = await U.confirm({ title: 'Start a new collage?', message: 'This clears the paper. Your photos stay in the tray. (Save the project first if you want to keep this one.)', ok: 'Clear paper', danger: true });
        if (!ok) return;
      }
      B.clear();
      B.resetHistory();
      CC.sources.gc(new Set());
      CC.sources.renderTray();
      CC.io.saveNow();
    },
  };

  async function loadFonts() {
    const jobs = [];
    for (const { f } of CC.FONTS) {
      if (f.includes(',')) continue;
      for (const w of ['400', '700']) for (const s of ['normal', 'italic']) jobs.push(document.fonts.load(`${s} ${w} 40px "${f}"`));
    }
    await Promise.allSettled(jobs);
    fabric.util.clearFabricFontCache();
  }

  function wireToolbar() {
    const photoInput = U.$('#photoInput');
    const projectInput = U.$('#projectInput');
    const pickPhotos = () => photoInput.click();
    photoInput.onchange = () => { CC.app.importFiles(photoInput.files); photoInput.value = ''; };
    projectInput.onchange = () => { if (projectInput.files[0]) CC.io.openProject(projectInput.files[0]); projectInput.value = ''; };

    U.$('#btnNew').onclick = CC.app.newCollage;
    U.$('#btnOpen').onclick = () => projectInput.click();
    U.$('#btnSave').onclick = CC.io.saveProject;
    U.$('#btnUndo').onclick = B.undo;
    U.$('#btnRedo').onclick = B.redo;
    U.$('#btnAddPhotos').onclick = pickPhotos;
    U.$('#btnTrayAdd').onclick = pickPhotos;
    U.$('#btnTrayBrowse').onclick = pickPhotos;
    U.$('#btnAddText').onclick = B.addText;
    U.$('#btnZoomIn').onclick = () => B.zoomAt(1.25);
    U.$('#btnZoomOut').onclick = () => B.zoomAt(0.8);
    U.$('#btnFit').onclick = B.fit;
    U.$('#zoomLabel').onclick = B.fit;
    U.$('#btnExport').onclick = CC.io.openExport;
    U.$$('.layers-panel [data-act]').forEach((b) => (b.onclick = () => CC.panels.act(b.dataset.act)));
  }

  function wireDrop() {
    const overlay = U.$('#dropOverlay');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      overlay.classList.add('show');
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.classList.remove('show');
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.classList.remove('show');
      const files = [...e.dataTransfer.files];
      const project = files.find((f) => /\.collage$/i.test(f.name));
      if (project) CC.io.openProject(project);
      else CC.app.importFiles(files);
    });

    window.addEventListener('paste', (e) => {
      if (U.isTyping(e) || CC.cutter.isOpen()) return;
      const items = [...(e.clipboardData ? e.clipboardData.items : [])];
      const files = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) {
        e.preventDefault();
        CC.app.importFiles(files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `Pasted image ${i + 1}.png`, { type: f.type })));
      }
    });
  }

  function wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (CC.cutter.isOpen() || U.anyModalOpen() || U.isTyping(e)) return;
      const a = B.canvas.getActiveObject();
      if (a && a.isEditing) return;
      const k = e.key;
      const lk = k.length === 1 ? k.toLowerCase() : k;
      const mod = U.mod(e);
      const step = (e.shiftKey ? 10 : 1) / B.zoom();
      if (k === ' ') {
        if (!e.repeat) B.setSpace(true);
      } else if (mod && lk === 'z') (e.shiftKey ? B.redo : B.undo)();
      else if (mod && lk === 'y') B.redo();
      else if (mod && lk === 'd') B.duplicateSelected();
      else if (mod && lk === 's') CC.io.saveProject();
      else if (mod && lk === 'o') U.$('#projectInput').click();
      else if (mod && lk === 'e') CC.io.openExport();
      else if (mod && lk === 'a') B.selectAll();
      else if (mod && k === '0') B.fit();
      else if (mod && (k === '=' || k === '+')) B.zoomAt(1.25);
      else if (mod && (k === '-' || k === '_')) B.zoomAt(0.8);
      else if (e.code === 'BracketRight') CC.panels.act(mod ? 'toFront' : 'forward');
      else if (e.code === 'BracketLeft') CC.panels.act(mod ? 'toBack' : 'backward');
      else if (k === 'Delete' || k === 'Backspace') B.deleteSelected();
      else if (k === 'Escape') { B.canvas.discardActiveObject(); B.canvas.requestRenderAll(); }
      else if (k === 'ArrowLeft') B.nudge(-step, 0);
      else if (k === 'ArrowRight') B.nudge(step, 0);
      else if (k === 'ArrowUp') B.nudge(0, -step);
      else if (k === 'ArrowDown') B.nudge(0, step);
      else if (e.shiftKey && !mod && lk === 'h') B.flip('x');
      else if (e.shiftKey && !mod && lk === 'v') B.flip('y');
      else if (!mod && !e.altKey && lk === 't') B.addText();
      else if (e.shiftKey && (k === '!' || e.code === 'Digit1')) B.fit();
      else return;
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') B.setSpace(false); });
    window.addEventListener('blur', () => B.setSpace(false));
  }

  async function start() {
    U.hydrateIcons();
    await CC.db.open();
    await loadFonts();
    B.init();
    CC.cutter.init();
    CC.panels.init();
    CC.io.initExport();
    CC.sources.initTray({ onCut: CC.app.openCutter, onWhole: CC.app.placeWhole });
    wireToolbar();
    wireDrop();
    wireKeys();

    await CC.sources.restore(await CC.db.getAllSources().catch(() => []));
    await CC.io.loadAutosave();
    CC.sources.gc(new Set(B.canvas.getObjects().filter((o) => o.kind === 'cut').map((o) => o.sourceId)));
    CC.sources.renderTray();
    B.resetHistory();
    B.fit();

    // autosave after every change from here on
    CC.on('change', () => CC.io.scheduleAutosave());
    document.addEventListener('visibilitychange', () => { if (document.hidden) CC.io.scheduleAutosave.flush(); });
    if (!CC.db.ok) U.toast('Autosave is unavailable in this browser mode. Use Save to keep your work.', 'warn', 6000);
    document.body.classList.add('ready');
  }

  start().catch((e) => {
    console.error(e);
    U.toast('Something went wrong starting up: ' + e.message, 'error', 10000);
  });
})(window.CC);
