'use strict';
/* Right-hand side: the layers list (drag to reorder, show/hide, lock, rename) and the
   context-sensitive properties panel (paper / cut-out / text / multi-selection). */
(function (CC) {
  const U = CC.util;
  const B = CC.board;
  const P = (CC.panels = {});

  CC.FONTS = [
    { f: 'Caveat', cat: 'Handwritten' },
    { f: 'Permanent Marker', cat: 'Marker' },
    { f: 'Rock Salt', cat: 'Scrawl' },
    { f: 'Special Elite', cat: 'Typewriter' },
    { f: 'Courier Prime', cat: 'Typewriter' },
    { f: 'Bebas Neue', cat: 'Poster' },
    { f: 'Anton', cat: 'Poster' },
    { f: 'Archivo Black', cat: 'Heavy' },
    { f: 'Playfair Display', cat: 'Serif' },
    { f: 'Abril Fatface', cat: 'Serif display' },
    { f: 'Lobster', cat: 'Script' },
    { f: 'Pacifico', cat: 'Script' },
    { f: 'Inter', cat: 'Sans' },
    { f: 'Helvetica, Arial, sans-serif', label: 'System Sans', cat: 'System' },
    { f: 'Georgia, "Times New Roman", serif', label: 'System Serif', cat: 'System' },
    { f: '"Courier New", monospace', label: 'System Mono', cat: 'System' },
  ];
  const fontLabel = (f) => (CC.FONTS.find((x) => x.f === f) || {}).label || f.replace(/"/g, '').split(',')[0];

  const INK = ['#1d1d1f', '#ffffff', '#e4572e', '#f2c14e', '#3a7d44', '#2d6cdf', '#7b3fa0', '#f49ac1'];
  const PAPERS = [
    ['#ffffff', 'White'], ['#f6f0e1', 'Cream'], ['#e9dcc3', 'Manila'], ['#c8a27a', 'Kraft'],
    ['#1c1c1e', 'Black'], ['#f7d6d0', 'Blush'], ['#d6e6f2', 'Sky'], ['#d9e4d0', 'Sage'],
  ];

  /* ---------- Layers ---------- */
  const renderLayers = U.rafThrottle(() => {
    const list = U.$('#layerList');
    const objs = B.canvas.getObjects().slice().reverse();
    const sel = new Set(B.selected());
    U.$('#layersEmpty').style.display = objs.length ? 'none' : '';
    list.innerHTML = objs
      .map((o) => {
        const thumb = o.kind === 'cut'
          ? `<img src="${CC.cuts.thumbURL(o.cutId)}" alt="" draggable="false">`
          : `<span class="tt" style="font-family:${U.esc(o.fontFamily)};color:${o.fill === '#ffffff' ? '#1d1d1f' : U.esc(o.fill)}">Aa</span>`;
        return `<li class="layer${sel.has(o) ? ' sel' : ''}${o.visible === false ? ' hidden-obj' : ''}${o.locked ? ' locked' : ''}" data-uid="${o.uid}" draggable="true">
          <span class="grip">${U.icon('grip')}</span>
          <span class="lthumb">${thumb}</span>
          <span class="lname" title="Double-click to rename">${U.esc(B.displayName(o))}</span>
          <button class="lbtn" data-a="lock" title="${o.locked ? 'Unlock' : 'Lock in place'}">${U.icon(o.locked ? 'lock' : 'unlock')}</button>
          <button class="lbtn" data-a="eye" title="${o.visible === false ? 'Show' : 'Hide'}">${U.icon(o.visible === false ? 'eyeOff' : 'eye')}</button>
        </li>`;
      })
      .join('');
    U.$('#emptyHint').classList.toggle('show', !objs.length);
  });

  function initLayers() {
    const list = U.$('#layerList');
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.layer');
      if (!li) return;
      const o = B.byUid(li.dataset.uid);
      if (!o) return;
      const btn = e.target.closest('[data-a]');
      if (btn) {
        if (btn.dataset.a === 'eye') {
          o.visible = o.visible === false;
          if (!o.visible) B.canvas.discardActiveObject();
        } else {
          B.applyLock(o, !o.locked);
          B.canvas.discardActiveObject();
          if (!o.locked) B.select([o]);
        }
        B.canvas.requestRenderAll();
        B.commit();
        CC.emit('selection');
        return;
      }
      B.exitEditing();
      if (e.shiftKey || U.mod(e)) {
        const cur = B.selected().filter((x) => x.selectable);
        const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o].filter((x) => x.selectable);
        B.select(next);
      } else {
        B.select([o]);
      }
    });
    list.addEventListener('dblclick', (e) => {
      const name = e.target.closest('.lname');
      if (!name) return;
      const li = name.closest('.layer');
      const o = B.byUid(li.dataset.uid);
      const input = document.createElement('input');
      input.className = 'lrename';
      input.value = B.displayName(o);
      name.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        if (save) { o.name = input.value.trim(); B.commit(); }
        renderLayers();
      };
      input.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') finish(true);
        if (ev.key === 'Escape') finish(false);
      };
      input.onblur = () => finish(true);
    });

    // drag to reorder
    let dragUid = null;
    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.layer');
      if (!li) return;
      dragUid = li.dataset.uid;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-collage-layer', dragUid);
      li.classList.add('dragging');
    });
    const clearMarks = () => U.$$('.layer', list).forEach((l) => l.classList.remove('drop-above', 'drop-below', 'dragging'));
    list.addEventListener('dragend', () => { dragUid = null; clearMarks(); });
    list.addEventListener('dragover', (e) => {
      if (!dragUid) return;
      const li = e.target.closest('.layer');
      e.preventDefault();
      U.$$('.layer', list).forEach((l) => l.classList.remove('drop-above', 'drop-below'));
      if (!li || li.dataset.uid === dragUid) return;
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
    });
    list.addEventListener('drop', (e) => {
      if (!dragUid) return;
      e.preventDefault();
      e.stopPropagation();
      const li = e.target.closest('.layer');
      const o = B.byUid(dragUid);
      if (li && o && li.dataset.uid !== dragUid) {
        const target = B.byUid(li.dataset.uid);
        const r = li.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2; // visually above = higher in the stack
        const rest = B.canvas.getObjects().filter((x) => x !== o);
        const t = rest.indexOf(target);
        B.withPlainSelection(() => B.moveToIndex(o, above ? t + 1 : t));
      }
      dragUid = null;
      clearMarks();
    });
  }

  /* ---------- Properties ---------- */
  const renderProps = () => {
    const box = U.$('#props');
    const objs = B.selected();
    if (!objs.length) box.innerHTML = paperHTML();
    else if (objs.length > 1) box.innerHTML = multiHTML(objs);
    else if (objs[0].kind === 'text') box.innerHTML = textHTML(objs[0]);
    else box.innerHTML = cutHTML(objs[0]);
    U.hydrateIcons(box);
    bindProps(objs);
  };
  P.render = renderProps;

  const swatches = (list, id) =>
    `<div class="swatches" data-for="${id}">${list.map((c) => {
      const [col, name] = Array.isArray(c) ? c : [c, c];
      return `<button class="sw" style="background:${col}" data-c="${col}" title="${name}"></button>`;
    }).join('')}</div>`;

  const arrangeHTML = (locked) => `
    <div class="psec">
      <h3>Layer order</h3>
      <div class="btn-row arrange">
        <button class="pbtn" data-act="toBack" data-icon="toBack" title="Send to back (Ctrl+[)" ${locked ? 'disabled' : ''}>Back</button>
        <button class="pbtn" data-act="backward" data-icon="chevDown" title="Send backward ([)" ${locked ? 'disabled' : ''}>Down</button>
        <button class="pbtn" data-act="forward" data-icon="chevUp" title="Bring forward (])" ${locked ? 'disabled' : ''}>Up</button>
        <button class="pbtn" data-act="toFront" data-icon="toFront" title="Bring to front (Ctrl+])" ${locked ? 'disabled' : ''}>Front</button>
      </div>
    </div>`;

  const commonHTML = (o) => `
    <div class="psec">
      <label class="slider-field full"><span>Opacity</span><input type="range" id="pOpacity" min="0" max="100" value="${Math.round((o.opacity ?? 1) * 100)}"><output>${Math.round((o.opacity ?? 1) * 100)}%</output></label>
      <label class="num-field"><span>Rotation</span><input type="number" id="pAngle" step="1" value="${Math.round(o.angle || 0)}">°
        <button class="pbtn small" id="pAngleReset" title="Straighten">${U.icon('rotate')}</button></label>
    </div>`;

  const actionsHTML = (opts = {}) => `
    <div class="btn-row">
      ${opts.reedit ? '<button class="pbtn" data-act="reedit" data-icon="scissors" title="Change the cut outline (or double-click the piece)">Re-edit cut</button>' : ''}
      <button class="pbtn" data-act="flipX" data-icon="flipH" title="Flip horizontally (Shift+H)">Flip H</button>
      <button class="pbtn" data-act="flipY" data-icon="flipV" title="Flip vertically (Shift+V)">Flip V</button>
    </div>
    <div class="btn-row">
      <button class="pbtn" data-act="duplicate" data-icon="copy" title="Duplicate (Ctrl+D)">Duplicate</button>
      <button class="pbtn danger" data-act="delete" data-icon="trash" title="Delete (Del)">Delete</button>
    </div>`;

  // On a zine spread, a piece can be trimmed to the page it sits on (so it doesn't cross the fold).
  function clipHTML(o) {
    const p = B.paper;
    if (!p.pages || p.pages.length < 2) return '';
    const c = B.objCenter(o);
    const i = o.clip != null ? o.clip : Math.max(0, B.pageIndexAt(c.x, c.y));
    const n = p.pages[i] ? p.pages[i].num : '';
    return `
      <div class="psec">
        <label class="check"><input type="checkbox" id="pClip" ${o.clip != null ? 'checked' : ''}> Trim to page ${n} (don’t cross the fold)</label>
      </div>`;
  }

  const lockedNote = (o) => (o.locked ? `<p class="note">${U.icon('lock')} Locked — unlock it in the layers list to edit.</p>` : '');

  function cutHTML(o) {
    const src = CC.sources.get(o.sourceId);
    return `
      <div class="psec">
        <h3>Cut-out</h3>
        <p class="sub">From “${U.esc(src ? src.name : 'photo')}”</p>
        ${lockedNote(o)}
        ${o.locked ? '' : actionsHTML({ reedit: true })}
      </div>
      ${o.locked ? '' : stickerHTML(o) + clipHTML(o) + commonHTML(o) + arrangeHTML(false)}`;
  }

  // Sticker thickness is shown in paper pixels (what you see), stored in cut-out pixels (scales with the piece).
  const stickerPaperPx = (o) => (o.sticker ? Math.max(1, Math.round(o.sticker.px * Math.abs(o.scaleX))) : 6);
  function stickerHTML(o) {
    const on = !!o.sticker;
    const STICKER_COLS = [['#ffffff', 'White'], ['#f6f0e1', 'Cream'], ['#1d1d1f', 'Black'], ['#f2c14e', 'Yellow'], ['#f49ac1', 'Pink'], ['#9ad0f5', 'Blue'], ['#b8e0a8', 'Green'], ['#e4572e', 'Red']];
    return `
      <div class="psec">
        <label class="check h"><input type="checkbox" id="pStickerOn" ${on ? 'checked' : ''}> ${U.icon('sticker')} Sticker border</label>
        <div class="sub-opts" id="pStickerOpts" ${on ? '' : 'hidden'}>
          <label class="slider-field full"><span>Thickness</span><input type="range" id="pStickerW" min="1" max="40" value="${stickerPaperPx(o)}"><output>${stickerPaperPx(o)}</output></label>
          <div class="row color-row"><span class="lbl">Colour</span><input type="color" id="pStickerC" value="${toHex(on ? o.sticker.color : '#ffffff')}">${swatches(STICKER_COLS, 'pStickerC')}</div>
          <label class="check"><input type="checkbox" id="pStickerShadow" ${on && o.sticker.shadow ? 'checked' : ''}> Soft shadow (helps a white border show on white paper)</label>
        </div>
      </div>`;
  }

  function multiHTML(objs) {
    return `
      <div class="psec">
        <h3>${objs.length} items selected</h3>
        ${actionsHTML()}
      </div>
      <div class="psec">
        <label class="slider-field full"><span>Opacity</span><input type="range" id="pOpacity" min="0" max="100" value="${Math.round((objs[0].opacity ?? 1) * 100)}"><output>${Math.round((objs[0].opacity ?? 1) * 100)}%</output></label>
      </div>
      ${arrangeHTML(false)}`;
  }

  function textHTML(o) {
    if (o.locked) return `<div class="psec"><h3>Text</h3>${lockedNote(o)}</div>`;
    const fontItems = CC.FONTS.map((f) => `<button class="font-item${f.f === o.fontFamily ? ' on' : ''}" data-f='${U.esc(f.f)}'><span style='font-family:${U.esc(f.f)}'>${U.esc(f.label || f.f)}</span><em>${f.cat}</em></button>`).join('');
    const strokeOn = o.strokeWidth > 0;
    return `
      <div class="psec">
        <h3>Text</h3>
        <textarea id="pText" rows="3" spellcheck="false">${U.esc(o.text)}</textarea>
        <div class="font-pick">
          <button class="font-btn" id="pFontBtn" style='font-family:${U.esc(o.fontFamily)}'>${U.esc(fontLabel(o.fontFamily))}</button>
          <div class="font-menu" id="pFontMenu" hidden>${fontItems}</div>
        </div>
        <div class="row">
          <label class="num-field"><span>Size</span><input type="number" id="pSize" min="4" max="2000" step="1" value="${Math.round(o.fontSize)}"></label>
          <div class="seg text-seg">
            <button id="pBold" class="${o.fontWeight === 'bold' ? 'on' : ''}" title="Bold"><b>B</b></button>
            <button id="pItalic" class="${o.fontStyle === 'italic' ? 'on' : ''}" title="Italic"><i>I</i></button>
          </div>
          <div class="seg" id="pAlign">
            ${['left', 'center', 'right'].map((a) => `<button data-v="${a}" class="${o.textAlign === a ? 'on' : ''}" title="Align ${a}">${U.icon(a === 'left' ? 'alignL' : a === 'center' ? 'alignC' : 'alignR')}</button>`).join('')}
          </div>
        </div>
        <div class="row color-row"><span class="lbl">Colour</span><input type="color" id="pFill" value="${toHex(o.fill)}">${swatches(INK, 'pFill')}</div>
        <label class="slider-field full"><span>Line spacing</span><input type="range" id="pLine" min="70" max="250" value="${Math.round(o.lineHeight * 100)}"><output>${o.lineHeight.toFixed(2)}</output></label>
        <label class="slider-field full"><span>Letter spacing</span><input type="range" id="pChar" min="-100" max="800" step="10" value="${o.charSpacing}"><output>${o.charSpacing}</output></label>
      </div>
      <div class="psec">
        <label class="check h"><input type="checkbox" id="pStrokeOn" ${strokeOn ? 'checked' : ''}> Outline</label>
        <div class="sub-opts" ${strokeOn ? '' : 'hidden'} id="pStrokeOpts">
          <div class="row color-row"><span class="lbl">Colour</span><input type="color" id="pStroke" value="${toHex(o.stroke || '#ffffff')}">${swatches(INK, 'pStroke')}</div>
          <label class="slider-field full"><span>Thickness</span><input type="range" id="pStrokeW" min="1" max="40" value="${strokeOn ? Math.round(Math.max(1, (o.strokeWidth / o.fontSize) * 100)) : 6}"><output></output></label>
        </div>
      </div>
      <div class="psec">
        <label class="check h"><input type="checkbox" id="pBoxOn" ${o.boxColor ? 'checked' : ''}> Label box behind text</label>
        <div class="sub-opts" ${o.boxColor ? '' : 'hidden'} id="pBoxOpts">
          <div class="row color-row"><span class="lbl">Colour</span><input type="color" id="pBox" value="${toHex(o.boxColor || '#f2c14e')}">${swatches(INK, 'pBox')}</div>
          <label class="slider-field full"><span>Padding</span><input type="range" id="pBoxPad" min="0" max="100" value="${Math.round(o.boxPad * 100)}"><output></output></label>
          <label class="slider-field full"><span>Rounding</span><input type="range" id="pBoxRad" min="0" max="100" value="${Math.round(o.boxRadius * 100)}"><output></output></label>
        </div>
      </div>
      ${clipHTML(o)}
      ${commonHTML(o)}
      <div class="psec">${actionsHTML()}</div>
      ${arrangeHTML(false)}`;
  }

  function paperHTML() {
    return (CC.zine.active ? CC.zine.panelHTML() : paperSecHTML()) + aiHTML() + tipsHTML();
  }

  function paperSecHTML() {
    const p = B.paper;
    const unit = p.unit || 'mm';
    const dec = unit === 'px' ? 0 : unit === 'in' ? 2 : 1;
    const fmt = (v) => +B.fromPx(v, unit).toFixed(dec);
    return `
      <div class="psec">
        <h3>${U.icon('page')} Paper</h3>
        <select id="pPreset">${B.PRESETS.map((pr) => `<option value="${pr.id}" ${pr.id === p.preset ? 'selected' : ''}>${pr.label}</option>`).join('')}</select>
        <div class="row">
          <div class="seg" id="pOrient">
            <button data-v="portrait" class="${p.h >= p.w ? 'on' : ''}" title="Portrait">${U.icon('portrait')}</button>
            <button data-v="landscape" class="${p.w > p.h ? 'on' : ''}" title="Landscape">${U.icon('landscape')}</button>
          </div>
          <label class="num-field compact"><input type="number" id="pW" min="1" step="any" value="${fmt(p.w)}"></label>
          <span class="times">×</span>
          <label class="num-field compact"><input type="number" id="pH" min="1" step="any" value="${fmt(p.h)}"></label>
          <select id="pUnit" class="unit">${['mm', 'in', 'px'].map((u) => `<option ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </div>
        <div class="row color-row"><span class="lbl">Colour</span><input type="color" id="pPaperColor" value="${toHex(p.color)}">${swatches(PAPERS, 'pPaperColor')}</div>
      </div>`;
  }

  function aiHTML() {
    return `
      <div class="psec" id="pAiSec" hidden>
        <h3>${U.icon('sparkles')} AI models</h3>
        <div class="ai-row"><span>Stored in this browser (~96 MB), so they work offline.</span>
          <button class="pbtn small" id="pAiRemove" title="Delete the downloaded AI models">Remove</button></div>
      </div>`;
  }

  function tipsHTML() {
    return `
      <div class="psec tips">
        <h3>${U.icon('keyboard')} Handy shortcuts</h3>
        <dl>
          <dt>Double-click piece</dt><dd>Re-edit its cut</dd>
          <dt>] / [</dt><dd>Layer up / down</dd>
          <dt>Ctrl+] / Ctrl+[</dt><dd>To front / back</dd>
          <dt>Ctrl+D</dt><dd>Duplicate</dd>
          <dt>Rotate</dt><dd>Clicks straight near 0°/90°/180°/270°</dd>
          <dt>Shift+rotate</dt><dd>Snap to 15°</dd>
          <dt>Arrows</dt><dd>Nudge (Shift = more)</dd>
          <dt>T</dt><dd>Add text</dd>
          <dt>Space+drag</dt><dd>Pan</dd>
          <dt>Ctrl+scroll</dt><dd>Zoom</dd>
          ${CC.zine.active ? '<dt>PgUp / PgDn</dt><dd>Previous / next zine page</dd>' : ''}
        </dl>
      </div>`;
  }

  function toHex(c) {
    if (!c) return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    const x = document.createElement('canvas').getContext('2d');
    x.fillStyle = c;
    return x.fillStyle.startsWith('#') ? x.fillStyle : '#000000';
  }

  /* ---------- Binding ---------- */
  function bindProps(objs) {
    const box = U.$('#props');
    const c = B.canvas;
    const $ = (id) => box.querySelector('#' + id);
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    const live = () => c.requestRenderAll();

    // action buttons
    U.$$('[data-act]', box).forEach((b) => (b.onclick = () => P.act(b.dataset.act)));

    // swatches set their colour input, then fire its events
    U.$$('.swatches', box).forEach((sw) => {
      sw.addEventListener('click', (e) => {
        const b = e.target.closest('.sw');
        if (!b) return;
        const input = $(sw.dataset.for);
        input.value = b.dataset.c;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
      });
    });

    // shared: opacity & rotation
    on('pOpacity', 'input', (e) => {
      const v = +e.target.value / 100;
      const a = c.getActiveObject();
      if (a && a.type === 'activeSelection') objs.forEach((o) => o.set('opacity', v));
      else if (a) a.set('opacity', v);
      e.target.nextElementSibling.textContent = e.target.value + '%';
      live();
    });
    on('pOpacity', 'change', () => B.commit());
    const setAngle = (v) => {
      const o = objs[0];
      o.rotate(v);
      o.setCoords();
      live();
      B.commit();
    };
    on('pAngle', 'change', (e) => setAngle(((+e.target.value % 360) + 360) % 360));
    on('pAngleReset', 'click', () => { setAngle(0); $('pAngle').value = 0; });

    if (objs.length === 1 && objs[0].kind === 'cut' && !objs[0].locked) bindSticker(objs[0], $, on);
    if (objs.length === 1) {
      on('pClip', 'change', (e) => {
        const o = objs[0];
        if (e.target.checked) {
          const c = B.objCenter(o);
          o.clip = Math.max(0, B.pageIndexAt(c.x, c.y));
        } else {
          delete o.clip;
        }
        c.requestRenderAll();
        B.commit();
        renderProps();
      });
    }
    if (!objs.length) bindPaper($, on);
    else if (objs.length === 1 && objs[0].kind === 'text' && !objs[0].locked) bindText(objs[0], $, on, live);
  }

  function bindSticker(o, $, on) {
    const apply = () => {
      const wanted = $('pStickerOn').checked;
      const paperPx = +$('pStickerW').value;
      B.setSticker(o, wanted ? { px: paperPx / Math.abs(o.scaleX || 1), color: $('pStickerC').value, shadow: $('pStickerShadow').checked } : null);
    };
    on('pStickerOn', 'change', (e) => { $('pStickerOpts').hidden = !e.target.checked; apply(); });
    on('pStickerW', 'input', (e) => { e.target.nextElementSibling.textContent = e.target.value; });
    on('pStickerW', 'change', apply); // re-render only when the slider is released
    on('pStickerC', 'change', apply);
    on('pStickerShadow', 'change', apply);
  }

  function bindPaper($, on) {
    CC.ai.isInstalled().then((yes) => { const sec = $('pAiSec'); if (sec) sec.hidden = !yes; });
    on('pAiRemove', 'click', async () => {
      const ok = await U.confirm({ title: 'Remove the AI models?', message: 'Frees about 96 MB. Find objects and Magic select will download them again the next time you use them.', ok: 'Remove', danger: true });
      if (!ok) return;
      await CC.ai.clear();
      U.toast('AI models removed', 'ok');
      renderProps();
    });
    if (CC.zine.active) return CC.zine.bindPanel($, on, renderProps);
    bindCollagePaper($, on);
  }

  function bindCollagePaper($, on) {
    on('pPreset', 'change', (e) => { B.applyPreset(e.target.value); renderProps(); });
    U.$$('#pOrient [data-v]').forEach((b) => (b.onclick = () => {
      const p = B.paper;
      const want = b.dataset.v;
      if ((want === 'landscape') !== (p.w > p.h) && p.w !== p.h) B.setPaper({ w: p.h, h: p.w, orient: want });
      renderProps();
    }));
    const applySize = () => {
      const unit = $('pUnit').value;
      const w = B.toPx(+$('pW').value, unit), h = B.toPx(+$('pH').value, unit);
      if (!(w > 0 && h > 0)) return;
      if (w > 20000 || h > 20000) { U.toast('That paper is too big', 'warn'); return renderProps(); }
      B.setPaper({ w, h, preset: 'custom', unit, orient: w > h ? 'landscape' : 'portrait' });
      renderProps();
    };
    on('pW', 'change', applySize);
    on('pH', 'change', applySize);
    on('pUnit', 'change', (e) => { B.paper.unit = e.target.value; B.commit(); renderProps(); });
    on('pPaperColor', 'input', (e) => { B.paper.color = e.target.value; B.canvas.requestRenderAll(); });
    on('pPaperColor', 'change', () => B.commit());
  }

  function bindText(o, $, on, live) {
    const setT = (props) => {
      o.set(props);
      B.syncTextPadding(o);
      o.setCoords();
      live();
      B.lastTextStyle = {
        fontFamily: o.fontFamily, fill: o.fill, fontWeight: o.fontWeight, fontStyle: o.fontStyle, textAlign: o.textAlign,
        stroke: o.stroke, strokeWidth: o.strokeWidth ? o.strokeWidth : 0, boxColor: o.boxColor, boxPad: o.boxPad, boxRadius: o.boxRadius,
        lineHeight: o.lineHeight, charSpacing: o.charSpacing,
      };
    };
    const commit = () => { B.commit(); CC.emit('layers'); };

    on('pText', 'input', (e) => { setT({ text: e.target.value }); CC.emit('layers'); });
    on('pText', 'change', commit);
    on('pText', 'keydown', (e) => e.stopPropagation());

    // font menu
    const menu = $('pFontMenu');
    on('pFontBtn', 'click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) {
        const cur = menu.querySelector('.on');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
      }
    });
    menu.addEventListener('click', async (e) => {
      const it = e.target.closest('.font-item');
      if (!it) return;
      const f = it.dataset.f;
      try { await document.fonts.load(`${o.fontStyle} ${o.fontWeight} 40px ${f.includes(',') ? f : `"${f}"`}`); } catch (_) { /* system font */ }
      fabric.util.clearFabricFontCache(f);
      setT({ fontFamily: f });
      commit();
      renderProps();
    });
    document.addEventListener('mousedown', function close(ev) {
      if (!menu.isConnected) return document.removeEventListener('mousedown', close);
      if (!ev.target.closest('.font-pick')) menu.hidden = true;
    });

    on('pSize', 'input', (e) => { const v = +e.target.value; if (v >= 4) setT({ fontSize: v }); });
    on('pSize', 'change', commit);
    on('pBold', 'click', () => { setT({ fontWeight: o.fontWeight === 'bold' ? 'normal' : 'bold' }); commit(); renderProps(); });
    on('pItalic', 'click', () => { setT({ fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }); commit(); renderProps(); });
    U.$$('#pAlign [data-v]').forEach((b) => (b.onclick = () => { setT({ textAlign: b.dataset.v }); commit(); renderProps(); }));
    on('pFill', 'input', (e) => setT({ fill: e.target.value }));
    on('pFill', 'change', commit);
    on('pLine', 'input', (e) => { setT({ lineHeight: +e.target.value / 100 }); e.target.nextElementSibling.textContent = (+e.target.value / 100).toFixed(2); });
    on('pLine', 'change', commit);
    on('pChar', 'input', (e) => { setT({ charSpacing: +e.target.value }); e.target.nextElementSibling.textContent = e.target.value; });
    on('pChar', 'change', commit);

    // outline
    const strokeW = () => (+$('pStrokeW').value / 100) * o.fontSize;
    on('pStrokeOn', 'change', (e) => {
      $('pStrokeOpts').hidden = !e.target.checked;
      setT(e.target.checked ? { stroke: $('pStroke').value, strokeWidth: strokeW() } : { strokeWidth: 0 });
      commit();
    });
    on('pStroke', 'input', (e) => setT({ stroke: e.target.value, strokeWidth: strokeW() }));
    on('pStroke', 'change', commit);
    on('pStrokeW', 'input', () => setT({ strokeWidth: strokeW() }));
    on('pStrokeW', 'change', commit);

    // label box
    on('pBoxOn', 'change', (e) => {
      $('pBoxOpts').hidden = !e.target.checked;
      setT({ boxColor: e.target.checked ? $('pBox').value : '' });
      commit();
    });
    on('pBox', 'input', (e) => setT({ boxColor: e.target.value }));
    on('pBox', 'change', commit);
    on('pBoxPad', 'input', (e) => setT({ boxPad: +e.target.value / 100 }));
    on('pBoxPad', 'change', commit);
    on('pBoxRad', 'input', (e) => setT({ boxRadius: +e.target.value / 100 }));
    on('pBoxRad', 'change', commit);
  }

  /* ---------- Actions (shared with keyboard shortcuts) ---------- */
  P.act = (a) => {
    const objs = B.selected();
    switch (a) {
      case 'reedit': if (objs[0]) CC.app.reEditCut(objs[0]); break;
      case 'flipX': B.flip('x'); break;
      case 'flipY': B.flip('y'); break;
      case 'duplicate': B.duplicateSelected(); break;
      case 'delete': B.deleteSelected(); break;
      case 'toFront': case 'toBack': case 'forward': case 'backward':
        if (objs.some((o) => o.locked)) return;
        B.arrange(a);
        break;
    }
  };

  // shared with the zine panel
  P.toHex = toHex;
  P.swatches = swatches;
  P.PAPERS = PAPERS;

  P.init = () => {
    initLayers();
    const propsActive = () => U.$('#props').contains(document.activeElement);
    CC.on('selection', () => { renderLayers(); renderProps(); });
    CC.on('change', (d) => {
      renderLayers();
      if ((d && d.restored) || !propsActive()) renderProps();
      U.$('#btnUndo').disabled = !B.canUndo();
      U.$('#btnRedo').disabled = !B.canRedo();
      CC.sources.renderTray();
    });
    CC.on('layers', renderLayers);
    CC.on('ai-installed', () => { if (!B.selected().length && !propsActive()) renderProps(); });
    CC.on('text-live', (o) => {
      renderLayers();
      const ta = U.$('#pText');
      if (ta && document.activeElement !== ta && B.selected()[0] === o) ta.value = o.text;
    });
    renderProps();
    renderLayers();
  };
})(window.CC);
