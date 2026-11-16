'use strict';
/* Persistence and output: browser autosave, .collage project files, PNG/JPEG/PDF export. */
(function (CC) {
  const U = CC.util;
  const B = CC.board;
  const IO = (CC.io = {});
  const FORMAT = 'collage-cutter';

  /* ---------- Autosave (IndexedDB) ---------- */
  const snapshot = () => {
    const state = B.getState();
    const cutIds = state.objects.filter((o) => o.kind === 'cut').map((o) => o.cutId);
    return { state, cuts: CC.cuts.serialize(cutIds) };
  };

  IO.saveNow = async () => {
    if (!CC.db.ok) return;
    try {
      await CC.db.setKV('project', snapshot());
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  };
  IO.scheduleAutosave = U.debounce(IO.saveNow, 500);

  IO.loadAutosave = async () => {
    const saved = await CC.db.getKV('project').catch(() => null);
    if (!saved || !saved.state) return false;
    CC.cuts.load(saved.cuts);
    B.restore(saved.state, { keepSelection: false });
    return true;
  };

  /* ---------- Project files ---------- */
  IO.saveProject = async () => {
    B.exitEditing();
    const snap = snapshot();
    const referenced = new Set(Object.values(snap.cuts).map((c) => c.sourceId));
    const sources = [];
    for (const s of CC.sources.list()) {
      if (s.hidden && !referenced.has(s.id)) continue;
      sources.push({ id: s.id, name: s.name, w: s.w, h: s.h, hidden: !!s.hidden, added: s.added, data: await U.blobToDataURL(s.blob) });
    }
    const file = { format: FORMAT, version: 1, savedAt: new Date().toISOString(), ...snap, sources };
    U.download(new Blob([JSON.stringify(file)], { type: 'application/json' }), `collage_${U.stamp()}.collage`);
    U.toast('Project saved to your downloads');
  };

  IO.openProject = async (file) => {
    let data;
    try {
      data = JSON.parse(await file.text());
      if (data.format !== FORMAT) throw new Error('not a collage file');
    } catch (e) {
      U.toast('That file isn’t a Collage Cutter project', 'error');
      return;
    }
    const hasWork = B.canvas.getObjects().length > 0;
    if (hasWork) {
      const ok = await U.confirm({ title: 'Open project?', message: 'This replaces the collage you have open now (save it first if you want to keep it).', ok: 'Open' });
      if (!ok) return;
    }
    await CC.sources.clearAll();
    CC.cuts.clear();
    let bad = 0;
    for (const s of data.sources || []) {
      try {
        const blob = await U.dataURLToBlob(s.data);
        await CC.sources.addRecord({ id: s.id, name: s.name, w: s.w, h: s.h, hidden: !!s.hidden, added: s.added || Date.now(), blob });
      } catch (e) {
        bad++;
      }
    }
    await CC.sources.persistAll();
    CC.cuts.load(data.cuts);
    B.restore(data.state, { keepSelection: false });
    B.fit();
    B.resetHistory();
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
  function flatten(c) {
    const out = U.canvas(c.width, c.height);
    const x = out.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, out.width, out.height);
    x.drawImage(c, 0, 0);
    return out;
  }
})(window.CC);
