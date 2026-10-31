// Floating window for Kimetsu World Engine.
// Self-contained: no dependency on SillyTavern internals, only the DOM.

const GEO_KEY = 'kwe_window_geo_v1';
const FAB_KEY = 'kwe_launcher_pos_v1';
const MIN_W = 300, MIN_H = 240, FAB = 52;

export const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

let win = null, hudEl = null, bodyEl = null, fab = null, minBtn = null;
let geo = null, fabPos = null, hooks = {}, modal = null;

const isNarrow = () => window.innerWidth <= 640;

function defaultGeo() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (isNarrow()) {
        const top = 56;
        return { left: 8, top, width: vw - 16, height: clamp(vh - top - 170, 300, 700), minimized: false };
    }
    const width = Math.min(430, vw - 32), height = Math.min(640, vh - 96);
    return { left: Math.max(8, vw - width - 24), top: 64, width, height, minimized: false };
}

function defaultFab() {
    return { left: window.innerWidth - FAB - 12, top: Math.max(60, window.innerHeight - FAB - 190) };
}

function applyGeo() {
    if (!win || !geo) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = clamp(geo.width, MIN_W, vw - 8);
    const height = clamp(geo.height, MIN_H, vh - 8);
    const left = clamp(geo.left, 4 - (width - 110), vw - 110);
    const top = clamp(geo.top, 0, vh - 56);
    Object.assign(win.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    win.classList.toggle('kwe-min', !!geo.minimized);
    if (minBtn) minBtn.textContent = geo.minimized ? '▢' : '▁';
}

function placeFab() {
    if (!fab || !fabPos) return;
    const left = clamp(fabPos.left, 4, window.innerWidth - FAB - 4);
    const top = clamp(fabPos.top, 4, window.innerHeight - FAB - 4);
    Object.assign(fab.style, { left: `${left}px`, top: `${top}px` });
}

const persist = () => write(GEO_KEY, geo);

// Pointer-based dragging that works for mouse, pen and touch.
function bindDrag(handle, { ignore, start, move, end }) {
    handle.addEventListener('pointerdown', e => {
        if (e.button !== undefined && e.button !== 0) return;
        if (ignore && e.target.closest(ignore)) return;
        const sx = e.clientX, sy = e.clientY;
        const origin = start();
        let moved = false;
        try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        const onMove = ev => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (!moved && Math.hypot(dx, dy) < 5) return;
            moved = true;
            move(origin, dx, dy);
        };
        const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            end?.(moved);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
        e.preventDefault();
    });
}

export function mountWindow({ title, onOpen, onClose, onMinimize } = {}) {
    if (win) return { body: bodyEl, hud: hudEl };
    hooks = { onOpen, onClose, onMinimize };
    geo = { ...defaultGeo(), ...(read(GEO_KEY) || {}) };

    win = document.createElement('div');
    win.id = 'kwe-window';
    win.className = 'kwe-window kwe-hidden';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'Kimetsu World Engine');
    win.innerHTML = `
      <div class="kwe-checker"></div>
      <div class="kwe-titlebar" id="kwe-titlebar">
        <div class="kwe-title">${title || 'Kimetsu World Engine'}</div>
        <div class="kwe-winbtns">
          <button type="button" data-win="min" aria-label="Minimize or expand" title="Minimize / expand">▁</button>
          <button type="button" data-win="close" aria-label="Close" title="Close">✕</button>
        </div>
      </div>
      <div class="kwe-hud" id="kwe-hud"></div>
      <div class="kwe-body" id="kwe-body"></div>
      <div class="kwe-resize" id="kwe-resize" aria-hidden="true"></div>`;
    document.body.appendChild(win);

    hudEl = win.querySelector('#kwe-hud');
    bodyEl = win.querySelector('#kwe-body');
    minBtn = win.querySelector('[data-win="min"]');

    win.addEventListener('click', e => {
        const b = e.target.closest('[data-win]');
        if (!b) return;
        if (b.dataset.win === 'close') closeWindow(); else toggleMinimize();
    });
    win.addEventListener('keydown', e => { if (e.key === 'Escape' && modal) closeModal(null); });
    win.querySelector('#kwe-titlebar').addEventListener('dblclick', e => { if (!e.target.closest('button')) toggleMinimize(); });

    // Move the window by its title bar (and HUD strip).
    for (const handle of [win.querySelector('#kwe-titlebar'), hudEl]) {
        bindDrag(handle, {
            ignore: 'button',
            start: () => ({ left: geo.left, top: geo.top, rect: win.getBoundingClientRect() }),
            move: (o, dx, dy) => { geo.left = o.rect.left + dx; geo.top = o.rect.top + dy; applyGeo(); },
            end: moved => { if (moved) { const r = win.getBoundingClientRect(); geo.left = r.left; geo.top = r.top; persist(); } },
        });
    }
    // Resize from the bottom-right corner.
    bindDrag(win.querySelector('#kwe-resize'), {
        start: () => { const r = win.getBoundingClientRect(); return { w: r.width, h: r.height }; },
        move: (o, dx, dy) => { geo.width = o.w + dx; geo.height = o.h + dy; applyGeo(); },
        end: moved => { if (moved) { const r = win.getBoundingClientRect(); geo.width = r.width; geo.height = r.height; persist(); } },
    });

    window.addEventListener('resize', () => { applyGeo(); placeFab(); });
    applyGeo();
    return { body: bodyEl, hud: hudEl };
}

export function mountLauncher({ visible = true, onToggle } = {}) {
    if (!fab) {
        fab = document.createElement('div');
        fab.id = 'kwe-launcher';
        fab.className = 'kwe-launcher';
        fab.setAttribute('role', 'button');
        fab.setAttribute('aria-label', 'Open Kimetsu World Engine');
        fab.tabIndex = 0;
        fab.textContent = '滅';
        document.body.appendChild(fab);
        fabPos = read(FAB_KEY) || defaultFab();
        placeFab();
        bindDrag(fab, {
            start: () => { const r = fab.getBoundingClientRect(); return { left: r.left, top: r.top }; },
            move: (o, dx, dy) => { fabPos = { left: o.left + dx, top: o.top + dy }; placeFab(); },
            end: moved => { if (moved) write(FAB_KEY, fabPos); else onToggle?.(); },
        });
        fab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(); } });
    }
    setLauncherVisible(visible);
}

export function setLauncherVisible(visible) { if (fab) fab.style.display = visible ? '' : 'none'; }
export const isOpen = () => !!win && !win.classList.contains('kwe-hidden');

export function openWindow() {
    if (!win) return;
    win.classList.remove('kwe-hidden');
    applyGeo();
    fab?.classList.add('on');
    hooks.onOpen?.();
}

export function closeWindow() {
    if (!win) return;
    closeModal(null);
    win.classList.add('kwe-hidden');
    fab?.classList.remove('on');
    hooks.onClose?.();
}

export const toggleWindow = () => (isOpen() ? closeWindow() : openWindow());

export function setMinimized(flag) {
    if (!win) return;
    geo.minimized = !!flag;
    applyGeo();
    persist();
    hooks.onMinimize?.(geo.minimized);
}
export const toggleMinimize = () => setMinimized(!geo.minimized);

export function setHud(html) { if (hudEl) hudEl.innerHTML = html; }

export function resetGeometry() {
    geo = { ...defaultGeo() };
    fabPos = defaultFab();
    applyGeo();
    placeFab();
    persist();
    write(FAB_KEY, fabPos);
}

// ---------- In-window forms (replace window.prompt / confirm) ----------

function closeModal(value) {
    if (!modal) return;
    const { root, resolve } = modal;
    modal = null;
    root.remove();
    resolve(value);
}

function fieldHtml(f) {
    const id = `kwe-f-${f.key}`;
    const val = f.value ?? '';
    let input;
    if (f.type === 'textarea') {
        input = `<textarea id="${id}" name="${esc(f.key)}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
    } else if (f.type === 'select') {
        input = `<select id="${id}" name="${esc(f.key)}">${(f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'number') {
        const mode = f.min !== undefined && f.min < 0 ? '' : `inputmode="${f.decimal ? 'decimal' : 'numeric'}"`;
        input = `<input id="${id}" name="${esc(f.key)}" type="number" ${mode} step="any" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}">`;
    } else {
        input = `<input id="${id}" name="${esc(f.key)}" type="text" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
    }
    return `<label class="kwe-field ${f.half ? 'half' : ''}" for="${id}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}</label>`;
}

function showModal(innerHtml) {
    closeModal(null);
    const root = document.createElement('div');
    root.className = 'kwe-modal';
    root.innerHTML = innerHtml;
    win.appendChild(root);
    root.addEventListener('pointerdown', e => { if (e.target === root) closeModal(null); });
    return new Promise(resolve => { modal = { root, resolve }; });
}

// fields: [{ key, label, type: text|number|textarea|select, value, options, half, required, min, decimal, placeholder }]
// Resolves with an object of values, or null when cancelled.
export function openForm({ title, fields, submitLabel = 'Save', note = '' }) {
    if (!win) return Promise.resolve(null);
    const promise = showModal(`
      <form class="kwe-sheet" novalidate>
        <div class="kwe-sheet-head"><b>${esc(title)}</b><button type="button" data-m="cancel" aria-label="Close">✕</button></div>
        ${note ? `<p class="kwe-muted">${esc(note)}</p>` : ''}
        <div class="kwe-fields">${fields.map(fieldHtml).join('')}</div>
        <div class="kwe-sheet-actions"><button type="button" data-m="cancel">Cancel</button><button type="submit" class="kwe-primary">${esc(submitLabel)}</button></div>
      </form>`);
    const root = modal.root, form = root.querySelector('form');
    root.addEventListener('click', e => { if (e.target.closest('[data-m="cancel"]')) closeModal(null); });
    form.addEventListener('submit', e => {
        e.preventDefault();
        const out = {};
        for (const f of fields) {
            const el = form.elements[f.key];
            const raw = el ? el.value : '';
            if (f.required && !String(raw).trim()) { el.classList.add('kwe-invalid'); el.focus(); return; }
            out[f.key] = f.type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
        }
        closeModal(out);
    });
    return promise;
}

export function openConfirm({ title = 'Confirm', message = '', confirmLabel = 'Confirm', danger = false } = {}) {
    if (!win) return Promise.resolve(false);
    const promise = showModal(`
      <div class="kwe-sheet">
        <div class="kwe-sheet-head"><b>${esc(title)}</b><button type="button" data-m="no" aria-label="Close">✕</button></div>
        <p>${esc(message)}</p>
        <div class="kwe-sheet-actions"><button type="button" data-m="no">Cancel</button><button type="button" data-m="yes" class="kwe-primary ${danger ? 'kwe-danger' : ''}">${esc(confirmLabel)}</button></div>
      </div>`);
    modal.root.addEventListener('click', e => {
        const b = e.target.closest('[data-m]');
        if (b) closeModal(b.dataset.m === 'yes');
    });
    return promise.then(v => v === true);
}
