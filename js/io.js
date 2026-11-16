'use strict';
/* Persistence and output: browser autosave, .collage project files, PNG/JPEG/PDF export.
   Zine mode keeps its own state (see zine.js); autosave stores both, plus which mode is open. */
(function (CC) {
  const U = CC.util;
  const B = CC.board;
  const IO = (CC.io = {});
  const FORMAT = 'collage-cutter';

  /* ---------- Autosave (IndexedDB) ---------- */
  IO.cutsFor = (objectLists) => {
    const ids = [];
    for (const list of objectLists) for (const o of list || []) if (o.kind === 'cut') ids.push(o.cutId);
    return CC.cuts.serialize(ids);
  };
  // The single collage (stashed away while zine mode is open)
  const collageSnapshot = () => {
    const state = CC.zine.active ? CC.zine.stash.state : B.getState();
    return { state, cuts: IO.cutsFor([state.objects]) };
  };

  IO.saveNow = async () => {
    if (!CC.db.ok) return;
    try {
      await CC.db.setKV('project', collageSnapshot());
      if (CC.zine.data) await CC.db.setKV('zine', CC.zine.snapshot());
      await CC.db.setKV('mode', CC.zine.active ? 'zine' : 'collage');
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  };
  IO.scheduleAutosave = U.debounce(IO.saveNow, 500);

  IO.loadAutosave = async () => {
    const saved = await CC.db.getKV('project').catch(() => null);
    if (saved && saved.state) {
      CC.cuts.load(saved.cuts);
      B.restore(saved.state, { keepSelection: false });
    }
    const zine = await CC.db.getKV('zine').catch(() => null);
    if (zine && zine.data) {
      CC.cuts.load(zine.cuts);
      CC.zine.load(zine.data);
    }
    if ((await CC.db.getKV('mode').catch(() => null)) === 'zine') CC.zine.enter({ silent: true });
  };

  /* Photos stored in a project file. The current tray photos are only hidden (not deleted), because
     pieces in the other mode may still use them; unused ones are cleaned up afterwards. */
  IO.loadSources = async (list, { replaceTray = true, hidden = false } = {}) => {
    if (replaceTray) for (const s of CC.sources.visible()) CC.sources.remove(s.id);
    let bad = 0;
    for (const s of list || []) {
      try {
        const have = CC.sources.get(s.id);
        if (have) {
          if (!hidden && !s.hidden && have.hidden) { have.hidden = false; CC.sources.persist(have); }
          continue;
        }
        const blob = await U.dataURLToBlob(s.data);
        const src = await CC.sources.addRecord({ id: s.id, name: s.name, w: s.w, h: s.h, hidden: hidden || !!s.hidden, added: s.added || Date.now(), blob });
        CC.sources.persist(src);
      } catch (e) {
        bad++;
      }
    }
    return bad;
  };
  IO.sourcesFor = async (cuts) => {
    const referenced = new Set(Object.values(cuts).map((c) => c.sourceId));
    const out = [];
    for (const s of CC.sources.list()) {
      if (s.hidden && !referenced.has(s.id)) continue;
      out.push({ id: s.id, name: s.name, w: s.w, h: s.h, hidden: !!s.hidden, added: s.added, data: await U.blobToDataURL(s.blob) });
    }
    return out;
  };

  /* ---------- Project files ---------- */
  IO.saveProject = async () => {
    B.exitEditing();
    if (CC.zine.active) return CC.zine.saveFile();
    const snap = collageSnapshot();
    const sources = await IO.sourcesFor(snap.cuts);
    const file = { format: FORMAT, version: 1, savedAt: new Date().toISOString(), ...snap, sources };
    U.download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `collage_${U.stamp()}.collage`);
    U.toast('Project saved to your downloads');
  };

  IO.readProjectFile = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.format === FORMAT || data.format === CC.zine.FORMAT) return data;
    } catch (e) { /* fall through */ }
    U.toast(`“${file.name}” isn’t a Collage Cutter file`, 'error');
    return null;
  };

  /* Open a .collage or .zine file, switching to the matching mode. */
  IO.openFile = async (file) => {
    const data = await IO.readProjectFile(file);
    if (!data) return;
    if (data.format === CC.zine.FORMAT) return CC.zine.openData(data);
    return IO.openProject(data);
  };

  IO.openProject = async (data) => {
    if (CC.zine.active) CC.zine.exit();
    const hasWork = B.canvas.getObjects().length > 0;
    if (hasWork) {
      const ok = await U.confirm({ title: 'Open project?', message: 'This replaces the collage you have open now (save it first if you want to keep it).', ok: 'Open' });
      if (!ok) return;
    }
    const bad = await IO.loadSources(data.sources);
    CC.cuts.load(data.cuts);
    B.restore(data.state, { keepSelection: false });
    B.fit();
    B.resetHistory();
    CC.sources.gc(CC.app.referencedSources());
    CC.sources.renderTray();
    IO.saveNow();
    U.toast(bad ? `Opened, but ${bad} photo(s) couldn’t be read` : 'Project opened', bad ? 'warn' : 'ok');
  };

  /* ---------- Export ---------- */
  const ex = { format: 'png', dpi: 300 };

  // Pixel-sized papers (social posts) export at 1×/2×/3× their pixel size; physical papers by DPI.
  const pxPaper = () => B.paper.unit === 'px';
  const exportScale = () => (pxPaper() ? { 96: 1, 150: 2, 300: 3 }[ex.dpi] : ex.dpi / 96);
  function labelDpiButtons() {
    const labels = pxPaper() ? { 96: '1× (exact)', 150: '2×', 300: '3×' } : { 96: 'Screen', 150: '150 DPI', 300: '300 DPI print' };
    U.$$('#exDpi button').forEach((b) => (b.textContent = labels[b.dataset.v]));
  }

  function updateExportInfo() {
    labelDpiButtons();
    const s = exportScale();
    const w = Math.round(B.paper.w * s), h = Math.round(B.paper.h * s);
    const mm = (v) => Math.round((v / 96) * 25.4);
    let info = `${w} × ${h} px`;
    if (B.paper.unit !== 'px') info += ` · prints at ${mm(B.paper.w)} × ${mm(B.paper.h)} mm`;
    if (w * h > 120e6) info += ' · very large, may be slow';
    U.$('#exInfo').textContent = info;
    U.$('#exQualityRow').style.display = ex.format === 'png' ? 'none' : '';
    U.$('#exTransparentRow').style.display = ex.format === 'png' ? '' : 'none';
    U.$$('#exFormat button').forEach((b) => b.classList.toggle('on', b.dataset.v === ex.format));
    U.$$('#exDpi button').forEach((b) => b.classList.toggle('on', +b.dataset.v === ex.dpi));
  }

  IO.initExport = () => {
    U.$$('#exFormat button').forEach((b) => (b.onclick = () => { ex.format = b.dataset.v; updateExportInfo(); }));
    U.$$('#exDpi button').forEach((b) => (b.onclick = () => { ex.dpi = +b.dataset.v; updateExportInfo(); }));
    const q = U.$('#exQuality');
    q.oninput = () => (U.$('#exQualityVal').textContent = q.value);
    U.$('#exGo').onclick = doExport;
  };

  let closeExport = null;
  IO.openExport = () => {
    B.exitEditing();
    if (CC.zine.active) return CC.zine.openExport();
    if (!B.canvas.getObjects().length) U.toast('The paper is empty — exporting a blank page', 'warn');
    updateExportInfo();
    closeExport = U.openModal(U.$('#exportDlg'));
    U.$('#exGo').focus();
  };

  async function doExport() {
    const btn = U.$('#exGo');
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    await new Promise((r) => setTimeout(r, 30)); // let the button repaint
    try {
      const scale = exportScale();
      const transparent = ex.format === 'png' && U.$('#exTransparent').checked;
      const canvas = B.renderExport(scale, { transparent });
      const quality = +U.$('#exQuality').value / 100;
      const name = `collage_${U.stamp()}`;
      if (ex.format === 'png') {
        U.download(await U.canvasToBlob(canvas, 'image/png'), name + '.png');
      } else if (ex.format === 'jpeg') {
        U.download(await U.canvasToBlob(flatten(canvas), 'image/jpeg', quality), name + '.jpg');
      } else {
        const { jsPDF } = window.jspdf;
        const wmm = (B.paper.w / 96) * 25.4, hmm = (B.paper.h / 96) * 25.4;
        const doc = new jsPDF({ orientation: wmm > hmm ? 'landscape' : 'portrait', unit: 'mm', format: [wmm, hmm], compress: true });
        doc.addImage(flatten(canvas).toDataURL('image/jpeg', quality), 'JPEG', 0, 0, wmm, hmm, undefined, 'NONE');
        doc.save(name + '.pdf');
      }
      closeExport && closeExport();
      U.toast('Exported ' + ex.format.toUpperCase(), 'ok');
    } catch (e) {
      console.error(e);
      U.toast('Export failed: ' + e.message, 'error', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export';
    }
  }

  // JPEG has no transparency: put a white backing under anything transparent
  IO.flatten = flatten;
  function flatten(c) {
    const out = U.canvas(c.width, c.height);
    const x = out.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, out.width, out.height);
    x.drawImage(c, 0, 0);
    return out;
  }
})(window.CC);
