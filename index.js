import { normalizeState, uid } from './database.js';
import { buildWorldPrompt } from './narrative.js';
import { awardExp, addItem, useItem, makeEnemy, playerAttack, enemyAttack, expForNext } from './rpg.js';
import { buildMemoryProtocol, parseMemoryProposal, applyMemoryProposal } from './memory.js';
import * as UI from './windowui.js';

const MODULE = 'kimetsu_world_engine';
const PREFIX = '[Kimetsu World Engine]';
const VERSION = '0.4.0';
const esc = UI.esc;

const TABS = [['dashboard', 'Overview'], ['character', 'Character'], ['combat', 'Combat'], ['missions', 'Missions'],
    ['npcs', 'NPCs'], ['memory', 'AI Memory'], ['world', 'World'], ['settings', 'Settings']];
const REL_TYPES = ['acquaintance', 'friend', 'ally', 'family', 'mentor', 'rival', 'enemy', 'other'];
const EFFECTS = [['heal', 'Heal HP'], ['stamina', 'Restore stamina']];
const NUM_FIELDS = [['level', 'Level'], ['exp', 'EXP'], ['hp', 'HP'], ['maxHp', 'Max HP'], ['attack', 'Attack'], ['defense', 'Defense'],
    ['speed', 'Speed'], ['stamina', 'Stamina'], ['maxStamina', 'Max stamina'], ['money', 'Money'], ['skillPoints', 'Skill points']];

let ctx, state, activeTab = 'dashboard';

/* ---------------- State helpers ---------------- */
function getState() {
    ctx = SillyTavern.getContext();
    let s = ctx.extensionSettings[MODULE];
    // Normalize once (and when migrating an older schema) so object identity stays stable across async forms.
    if (!s || s.schemaVersion !== 3) s = ctx.extensionSettings[MODULE] = normalizeState(s || {});
    state = s;
    return s;
}
function save() { ctx = SillyTavern.getContext(); ctx.saveSettingsDebounced(); }
function activeChatData() {
    ctx = SillyTavern.getContext();
    const meta = ctx.chatMetadata;
    const cd = (meta[`${MODULE}_chat`] ??= {});
    cd.memories ??= []; cd.pendingMemoryProposals ??= []; cd.processedProposalKeys ??= [];
    cd.memorySettings ??= { autoDetect: true, minConfidence: 0.55 };
    cd.combat ??= { active: false, enemy: null, log: [] };
    cd.combat.log ??= [];
    cd.world ??= { location: 'Unknown', time: 'Day 1 · 08:00' };
    return cd;
}
function hasChat() { return !!SillyTavern.getContext().chatId; }
function saveChat() {
    ctx = SillyTavern.getContext();
    if (!ctx.chatId) return;
    try { Promise.resolve(ctx.saveMetadata()).catch(e => console.warn(PREFIX, 'saveMetadata failed', e)); } catch (e) { console.warn(PREFIX, e); }
}
function notify(message, type = 'success') {
    if (window.toastr?.[type]) window.toastr[type](message, 'Kimetsu World Engine');
    else console.info(PREFIX, message);
}
function insertIntoChat(text, doneMessage) {
    const $input = $('#send_textarea');
    if (!$input.length) { notify('Chat input not found. Open a chat first.', 'warning'); return false; }
    const prev = String($input.val() || '');
    $input.val(prev ? `${prev}\n\n${text}` : text).trigger('input');
    UI.setMinimized(true); // reveal the chat box so the player can review and send
    notify(doneMessage || 'Inserted into the chat box. Review it, then send.');
    return true;
}
function hashText(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `${h}:${text.length}`;
}

/* ---------------- Small view helpers ---------------- */
function bar(value, max, cls = '') {
    const pct = Math.max(0, Math.min(100, (Number(value) / Math.max(1, Number(max))) * 100));
    return `<div class="kwe-bar ${cls}"><span style="width:${pct}%"></span></div>`;
}
function miniBar(label, value, max, cls) {
    const pct = Math.max(0, Math.min(100, (Number(value) / Math.max(1, Number(max))) * 100));
    return `<div class="kwe-mini ${cls}"><i style="width:${pct}%"></i><em>${label} ${value}/${max}</em></div>`;
}
function field(id, label, value, { type = 'text', full = false } = {}) {
    return `<label class="kwe-field ${full ? 'full' : ''}">${label}<input id="${id}" type="${type}" ${type === 'number' ? 'inputmode="numeric"' : ''} value="${esc(value)}"></label>`;
}

function renderHud() {
    const p = getState().player, cd = activeChatData();
    const e = cd.combat.active ? cd.combat.enemy : null;
    UI.setHud(`<div class="kwe-hud-top"><b>${esc(p.name)}</b><span>${esc(p.rank)} · Lv.${p.level}</span></div>
      <div class="kwe-hud-bars">${miniBar('HP', p.hp, p.maxHp, 'hp')}${miniBar('STA', p.stamina, p.maxStamina, 'sta')}</div>
      ${e ? `<div class="kwe-hud-enemy">⚔ ${esc(e.name)} · ${e.hp}/${e.maxHp} HP</div>` : ''}`);
}

/* ---------------- Views ---------------- */
function viewDashboard(p, cd) {
    const e = cd.combat.active && cd.combat.enemy;
    const active = state.missions.filter(m => m.status === 'Active').length;
    const done = state.missions.filter(m => m.status === 'Completed').length;
    const need = expForNext(p.level);
    const items = p.inventory.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
    return `<div class="kwe-hero"><div><div class="kwe-hero-name">${esc(p.name)}</div><div class="kwe-muted">${esc(p.rank)} · ${esc(p.breathing)}</div></div><div class="kwe-lv">Lv.<b>${p.level}</b></div></div>
      <div class="kwe-xp"><small>EXP ${p.exp}/${need}</small>${bar(p.exp, need)}</div>
      <div class="kwe-grid">${[['ATK', p.attack], ['DEF', p.defense], ['SPD', p.speed], ['¥', p.money], ['SP', p.skillPoints], ['Items', items]]
        .map(([l, v]) => `<div class="kwe-stat"><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
      <h4>Battle status / สถานะการต่อสู้</h4>
      ${e ? `<div class="kwe-card"><div class="kwe-card-head"><b>${esc(e.name)}</b><span class="kwe-badge">${esc(e.rank)}</span></div><p>${e.hp}/${e.maxHp} HP</p>${bar(e.hp, e.maxHp, 'enemy')}</div>` : '<p class="kwe-muted">No active encounter / ไม่มีการต่อสู้</p>'}
      <div class="kwe-actions"><button class="kwe-primary" data-goto="combat">⚔ Open Combat</button><button data-action="insert-prompt">Insert RPG context</button><button data-action="export">Export JSON</button></div>
      <h4>Missions</h4><p>${active} active · ${done} completed</p>
      <p class="kwe-note">ระบบเกมจะเป็นตัวจัดการค่าสถานะและรางวัล ส่วน AI ทำหน้าที่เล่าเรื่องตามผลลัพธ์ที่บันทึกไว้</p>`;
}

function viewCharacter(p) {
    const row = (id, label, full) => field(`kwe-p-${id}`, label, p[id], { full });
    return `<h4>Player character / ตัวละครผู้เล่น</h4>
      <div class="kwe-form-grid">${row('name', 'Name', true)}${row('rank', 'Demon Slayer rank', true)}${row('breathing', 'Breathing style', true)}
      ${NUM_FIELDS.map(([k, l]) => field(`kwe-p-${k}`, l, p[k], { type: 'number' })).join('')}</div>
      <div class="kwe-actions"><button class="kwe-primary" data-action="save-player">Save character</button><button data-action="rest">Rest (recover)</button></div>
      <h4>Skills / ทักษะปราณ</h4>
      ${p.skills.map(s => `<div class="kwe-card"><div class="kwe-card-head"><b>${esc(s.name)}</b><button data-action="delete-skill" data-id="${esc(s.id)}" aria-label="Delete skill">✕</button></div><p>${esc(s.nameTh || '')}</p><div class="kwe-tags"><i>Power ×${s.power}</i><i>Cost ${s.cost} STA</i></div><small>${esc(s.description || '')}</small></div>`).join('') || '<p class="kwe-muted">No skills yet.</p>'}
      <div class="kwe-actions"><button data-action="add-skill">＋ Add skill</button></div>
      <h4>Inventory / กระเป๋า</h4>
      ${p.inventory.map(i => `<div class="kwe-inventory"><span>${esc(i.name)} ×${i.quantity}<small> · ${esc(i.effect)} +${i.value}</small></span><span><button data-action="use-item" data-id="${esc(i.id)}">Use</button> <button data-action="discard-item" data-id="${esc(i.id)}" aria-label="Discard item">✕</button></span></div>`).join('') || '<p class="kwe-muted">Inventory empty</p>'}
      <div class="kwe-actions"><button data-action="add-item">＋ Add item</button></div>`;
}

function viewCombat(p, cd) {
    const c = cd.combat;
    const consumables = p.inventory.filter(i => i.effect === 'heal' || i.effect === 'stamina');
    if (c.active && c.enemy) {
        const e = c.enemy;
        return `<div class="kwe-combat"><div class="kwe-combat-title"><span>ENCOUNTER</span><b>${esc(e.name)} · ${esc(e.rank)}</b></div>
          <p class="kwe-muted">Lv.${e.level} · ATK ${e.attack} · DEF ${e.defense}</p>
          <div class="kwe-enemy-hp">${e.hp}/${e.maxHp} HP</div>${bar(e.hp, e.maxHp, 'enemy')}</div>
          <h4>Actions</h4>
          <div class="kwe-actions"><button class="kwe-primary" data-action="basic-attack">⚔ Basic attack</button><button data-action="flee">Flee</button></div>
          <div class="kwe-skillgrid">${p.skills.map(s => `<button data-action="skill-attack" data-id="${esc(s.id)}" ${p.stamina < s.cost ? 'disabled' : ''}><b>${esc(s.name)}</b><small>×${s.power} · −${s.cost} STA</small></button>`).join('')}</div>
          ${consumables.length ? `<h4>Items (no turn cost)</h4><div class="kwe-actions">${consumables.map(i => `<button data-action="use-item" data-id="${esc(i.id)}">${esc(i.name)} ×${i.quantity}</button>`).join('')}</div>` : ''}
          <h4>Battle log</h4><div class="kwe-log">${(c.log || []).slice(-8).reverse().map(x => `<p>${esc(x)}</p>`).join('')}</div>`;
    }
    return `<h4>Start an encounter / เริ่มการต่อสู้</h4><p class="kwe-muted">เลือกศัตรูเพื่อเริ่มการต่อสู้แบบ Turn-based</p>
      ${state.enemyTemplates.map(e => `<div class="kwe-card"><div class="kwe-card-head"><b>${esc(e.name)}</b><span class="kwe-badge">${esc(e.rank)}</span></div><p>HP ${e.hp} · ATK ${e.attack} · DEF ${e.defense} · Reward ${e.exp} EXP</p><button data-action="start-combat" data-id="${esc(e.id)}">Engage</button></div>`).join('')}
      ${(c.log || []).length ? `<h4>Last battle log</h4><div class="kwe-log">${c.log.slice(-6).reverse().map(x => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
      <div class="kwe-actions"><button data-action="rest">Rest / Recover</button></div>`;
}

function viewMissions() {
    return `<div class="kwe-actions"><button class="kwe-primary" data-action="add-mission">＋ Create mission</button></div>
      ${state.missions.map(m => `<div class="kwe-card"><div class="kwe-card-head"><b>${esc(m.title)}</b><span class="kwe-badge">${esc(m.status)}</span></div><p>${esc(m.description)}</p><div class="kwe-tags"><i>${m.exp} EXP</i><i>${m.money} ¥</i></div>
        <div class="kwe-actions">${m.status === 'Active' ? `<button class="kwe-primary" data-action="complete-mission" data-id="${esc(m.id)}">Complete</button>` : ''}<button data-action="delete-mission" data-id="${esc(m.id)}">Delete</button></div></div>`).join('') || '<p class="kwe-muted">No missions created yet.</p>'}`;
}

function npcCard(n) {
    const mem = (n.memories || []).slice(-5).reverse().map(m => `<li>${esc(typeof m === 'string' ? m : m.text)}</li>`).join('');
    const rel = (n.relationships || []).map(r => `<i>${esc(r.target)}: ${esc(r.type)} ${r.value ?? 0}</i>`).join('');
    return `<div class="kwe-card"><div class="kwe-card-head"><b>${esc(n.name)}</b><span class="kwe-badge">${esc(n.role || 'NPC')}</span></div>
      <p>${esc(n.personality || 'No personality set')}</p>
      <div class="kwe-tags"><i>Trust ${n.trust}/100</i><i>${esc(n.breathing || 'No breathing style')}</i>${rel}</div>${bar(n.trust, 100)}
      <details><summary>${(n.memories || []).length} memories</summary><ul class="kwe-memlist">${mem || '<li class="kwe-muted">None</li>'}</ul></details>
      <div class="kwe-actions"><button data-action="edit-npc" data-id="${esc(n.id)}">Edit</button><button data-action="memory" data-id="${esc(n.id)}">＋ Memory</button><button data-action="relationship" data-id="${esc(n.id)}">Relationship</button><button data-action="delete-npc" data-id="${esc(n.id)}">Delete</button></div></div>`;
}
function viewNpcs() {
    return `<div class="kwe-actions"><button class="kwe-primary" data-action="add-npc">＋ Create NPC</button><button data-action="insert-prompt">Insert NPC context</button></div>
      ${state.npcs.map(npcCard).join('') || '<p class="kwe-muted">No NPC registered.</p>'}`;
}

function viewMemory(cd) {
    const proposals = cd.pendingMemoryProposals || [];
    return `<div class="kwe-memory-intro"><b>AI Memory Synchronization</b><p>AI proposes persistent changes; nothing is saved until you approve it.</p>
        <div class="kwe-tags"><i>${proposals.length} pending</i><i>${(cd.memories || []).length} world memories</i><i>${state.npcs.length} registered NPCs</i></div></div>
      <div class="kwe-actions"><button class="kwe-primary" data-action="analyze-chat">Analyze recent conversation</button><button data-action="insert-protocol">Insert RPG + memory protocol</button></div>
      <label class="kwe-check"><input type="checkbox" id="kwe-memory-auto" ${cd.memorySettings?.autoDetect !== false ? 'checked' : ''}> Automatically detect proposal blocks in AI replies</label>
      <p class="kwe-muted">Insert the protocol into the chat and send it to the model. When the AI answers with a proposal block it appears here for review.</p>
      ${proposals.map(pr => `<div class="kwe-card kwe-proposal"><div class="kwe-card-head"><b>${esc(pr.summary || 'Memory proposal')}</b><span class="kwe-badge">Pending</span></div>
        ${(pr.memories || []).map(m => `<div class="kwe-proposal-item"><b>Memory · ${esc(m.npcName)}</b><p>${esc(m.text)}</p><small>Importance ${m.importance}/5 · Confidence ${Math.round(m.confidence * 100)}%</small><p class="kwe-muted">${esc(m.reason)}</p></div>`).join('')}
        ${(pr.relationships || []).map(r => `<div class="kwe-proposal-item"><b>Relationship · ${esc(r.npcName)} → ${esc(r.target)}</b><p>${esc(r.type)} · ${r.delta > 0 ? '+' : ''}${r.delta} affinity</p><small>${esc(r.reason)}</small></div>`).join('')}
        ${(pr.worldEvents || []).map(e => `<div class="kwe-proposal-item"><b>World event</b><p>${esc(e.text)}</p></div>`).join('')}
        <div class="kwe-actions"><button class="kwe-primary" data-action="approve-proposal" data-id="${esc(pr.id)}">✓ Approve all</button><button data-action="edit-proposal" data-id="${esc(pr.id)}">Edit & approve</button><button data-action="reject-proposal" data-id="${esc(pr.id)}">Reject</button></div></div>`).join('')
        || '<p class="kwe-muted">No pending proposals. Use Analyze recent conversation or wait for an AI proposal block.</p>'}`;
}

function viewWorld(cd) {
    return `<label class="kwe-field full">Current location<input id="kwe-location" value="${esc(cd.world.location)}"></label>
      <label class="kwe-field full">World time<input id="kwe-time" value="${esc(cd.world.time)}"></label>
      <label class="kwe-field full">Record event / บันทึกเหตุการณ์<textarea id="kwe-event" rows="3" placeholder="Describe an important event..."></textarea></label>
      <div class="kwe-actions"><button class="kwe-primary" data-action="save-world">Save world</button></div>
      <h4>Recent memories</h4>
      ${(cd.memories || []).slice(-10).reverse().map(m => `<div class="kwe-card"><small>${esc(m.createdAt || '')}</small><p>${esc(m.text)}</p></div>`).join('') || '<p class="kwe-muted">No memories recorded.</p>'}`;
}

function viewSettings() {
    const f = state.format;
    return `<h4>Narrative output / รูปแบบการเล่าเรื่อง</h4>
      ${[['header', 'Character header / ข้อมูลตัวละคร'], ['dialogue', 'Dialogue / บทสนทนา'], ['monologue', 'Monologue / ความคิด'], ['narration', 'Narration / คำบรรยาย'], ['status', 'Status footer / สถานะท้ายข้อความ']]
        .map(([k, l]) => `<label class="kwe-check"><input type="checkbox" id="kwe-format-${k}" ${f[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <label class="kwe-field full">Language<select id="kwe-language"><option value="both" ${state.language === 'both' ? 'selected' : ''}>Thai + English</option><option value="th" ${state.language === 'th' ? 'selected' : ''}>ไทย</option><option value="en" ${state.language === 'en' ? 'selected' : ''}>English</option></select></label>
      <div class="kwe-actions"><button class="kwe-primary" data-action="save-format">Save settings</button></div>
      <h4>Window / หน้าต่าง</h4>
      <label class="kwe-check"><input type="checkbox" class="kwe-launcher-toggle" ${state.ui.launcher !== false ? 'checked' : ''}> Show floating 滅 button</label>
      <div class="kwe-actions"><button data-action="reset-window">Reset window position</button></div>
      <p class="kwe-note">Drag the title bar to move · drag the bottom-right corner to resize · ▁ collapses the window to a small HUD · drag the 滅 button anywhere.</p>`;
}

function renderTab(tab = activeTab) {
    const $v = $('#kwe-view');
    if (!$v.length) return;
    getState();
    const cd = activeChatData(), p = state.player;
    const keep = tab === activeTab ? $v.scrollTop() : 0;
    activeTab = tab;
    const views = {
        dashboard: () => viewDashboard(p, cd), character: () => viewCharacter(p), combat: () => viewCombat(p, cd),
        missions: viewMissions, npcs: viewNpcs, memory: () => viewMemory(cd), world: () => viewWorld(cd), settings: viewSettings,
    };
    $v.html((views[tab] || views.dashboard)()).scrollTop(keep);
    const $tabs = $('#kwe-tabs');
    const $btn = $tabs.find('[data-tab]').removeClass('active').filter(`[data-tab="${tab}"]`).addClass('active');
    if ($btn.length) $tabs[0].scrollLeft = $btn[0].offsetLeft - ($tabs[0].clientWidth - $btn[0].offsetWidth) / 2;
    renderHud();
}
const refresh = () => renderTab(activeTab);

/* ---------------- Combat ---------------- */
function logCombat(text) {
    const c = activeChatData().combat;
    c.log.push(`${new Date().toLocaleTimeString()} — ${text}`);
    c.log = c.log.slice(-30);
}
function finishEnemy() {
    const cd = activeChatData(), e = cd.combat.enemy;
    const levels = awardExp(state.player, e.exp);
    state.player.money += e.reward;
    logCombat(`Victory! +${e.exp} EXP, +${e.reward} ¥.`);
    cd.combat.active = false; cd.combat.enemy = null;
    notify(`Victory! +${e.exp} EXP${levels.length ? ` · Level ${levels.join(', ')}` : ''}`);
}
function enemyTurn() {
    const cd = activeChatData();
    if (!cd.combat.active || !cd.combat.enemy) return;
    const result = enemyAttack(state.player, cd.combat.enemy);
    logCombat(`${cd.combat.enemy.name} attacks for ${result.damage} damage.`);
    if (result.defeated) {
        logCombat('You were defeated. Recover with Rest before another battle.');
        cd.combat.active = false; cd.combat.enemy = null;
        notify('You were defeated.', 'error');
    }
}
function performAttack(skillId = null) {
    const cd = activeChatData();
    if (!cd.combat.active || !cd.combat.enemy) return;
    const result = playerAttack(state.player, cd.combat.enemy, skillId);
    if (!result.ok) return notify(result.message, 'warning');
    logCombat(`You use ${result.skill} and deal ${result.damage} damage.`);
    if (result.defeated) finishEnemy(); else enemyTurn();
    save(); saveChat(); refresh();
}

/* ---------------- Actions ---------------- */
const num = (v, fallback = 0) => (v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));
const findProposal = (cd, id) => cd.pendingMemoryProposals.find(x => x.id === id);

const actions = {
    'save-player'() {
        const p = state.player, val = k => $(`#kwe-p-${k}`).val();
        for (const k of ['name', 'rank', 'breathing']) p[k] = String(val(k) || '').trim() || p[k];
        for (const [k] of NUM_FIELDS) p[k] = Math.max(0, Number(val(k)) || 0);
        p.level = Math.max(1, Math.floor(p.level)); p.maxHp = Math.max(1, p.maxHp); p.maxStamina = Math.max(1, p.maxStamina);
        p.expToNext = expForNext(p.level); p.hp = Math.min(p.hp, p.maxHp); p.stamina = Math.min(p.stamina, p.maxStamina);
        save(); notify('Character saved'); refresh();
    },
    rest() { const p = state.player; p.hp = p.maxHp; p.stamina = p.maxStamina; save(); notify('HP and stamina fully recovered'); refresh(); },
    async 'add-skill'() {
        const v = await UI.openForm({ title: 'Add breathing skill', fields: [
            { key: 'name', label: 'Skill name', required: true }, { key: 'nameTh', label: 'Thai name' },
            { key: 'power', label: 'Power ×', type: 'number', value: 1.5, half: true, decimal: true },
            { key: 'cost', label: 'Stamina cost', type: 'number', value: 5, half: true },
            { key: 'description', label: 'Description', type: 'textarea' }] });
        if (!v) return;
        state.player.skills.push({ id: uid(), name: v.name.trim(), nameTh: v.nameTh.trim(), type: 'attack', power: num(v.power, 1.5) || 1.5, cost: Math.max(0, num(v.cost, 5)), description: v.description.trim() });
        save(); refresh();
    },
    async 'delete-skill'(id) {
        if (!await UI.openConfirm({ title: 'Delete skill', message: 'Remove this skill?', confirmLabel: 'Delete', danger: true })) return;
        state.player.skills = state.player.skills.filter(s => s.id !== id); save(); refresh();
    },
    async 'add-item'() {
        const v = await UI.openForm({ title: 'Add item', fields: [
            { key: 'name', label: 'Item name', required: true },
            { key: 'effect', label: 'Effect', type: 'select', options: EFFECTS, value: 'heal' },
            { key: 'value', label: 'Effect value', type: 'number', value: 20, half: true },
            { key: 'quantity', label: 'Quantity', type: 'number', value: 1, half: true }] });
        if (!v) return;
        addItem(state.player.inventory, { id: uid(), name: v.name.trim(), nameTh: '', type: 'consumable', quantity: Math.max(1, Math.floor(num(v.quantity, 1))), effect: v.effect, value: Math.max(1, num(v.value, 20)) });
        save(); refresh();
    },
    async 'discard-item'(id) {
        if (!await UI.openConfirm({ title: 'Discard item', message: 'Remove this item from the inventory?', confirmLabel: 'Discard', danger: true })) return;
        state.player.inventory = state.player.inventory.filter(i => i.id !== id); save(); refresh();
    },
    'use-item'(id) { const r = useItem(state.player, id); notify(r.message, r.ok ? 'success' : 'warning'); save(); refresh(); },
    'start-combat'(id) {
        if (!hasChat()) return notify('Open a chat first.', 'warning');
        if (state.player.hp <= 0) return notify('Recover your HP before fighting.', 'warning');
        const template = state.enemyTemplates.find(e => e.id === id); if (!template) return;
        const cd = activeChatData();
        cd.combat = { active: true, enemy: makeEnemy(template, state.player.level), log: [] };
        logCombat(`Encounter started: ${template.name}.`);
        saveChat(); refresh();
    },
    'basic-attack'() { performAttack(); },
    'skill-attack'(id) { performAttack(id); },
    flee() { const cd = activeChatData(); logCombat('You fled from battle.'); cd.combat.active = false; cd.combat.enemy = null; saveChat(); refresh(); },
    async 'add-mission'() {
        const v = await UI.openForm({ title: 'Create mission', fields: [
            { key: 'title', label: 'Mission title', required: true }, { key: 'description', label: 'Description', type: 'textarea' },
            { key: 'exp', label: 'EXP reward', type: 'number', value: 50, half: true }, { key: 'money', label: 'Money reward', type: 'number', value: 20, half: true }] });
        if (!v) return;
        state.missions.push({ id: uid(), title: v.title.trim(), description: v.description.trim(), exp: Math.max(0, num(v.exp)), money: Math.max(0, num(v.money)), status: 'Active' });
        save(); refresh();
    },
    'complete-mission'(id) {
        const m = state.missions.find(x => x.id === id); if (!m || m.status !== 'Active') return;
        m.status = 'Completed'; const ups = awardExp(state.player, m.exp); state.player.money += m.money;
        notify(`Mission completed · +${m.exp} EXP · +${m.money} ¥${ups.length ? ` · Level ${ups.join(', ')}` : ''}`);
        save(); refresh();
    },
    async 'delete-mission'(id) {
        if (!await UI.openConfirm({ title: 'Delete mission', message: 'Delete this mission?', confirmLabel: 'Delete', danger: true })) return;
        state.missions = state.missions.filter(x => x.id !== id); save(); refresh();
    },
    async 'add-npc'() { await npcForm(null); },
    async 'edit-npc'(id) { await npcForm(state.npcs.find(n => n.id === id)); },
    async 'delete-npc'(id) {
        if (!await UI.openConfirm({ title: 'Delete NPC', message: 'Delete this NPC and all of their memories?', confirmLabel: 'Delete', danger: true })) return;
        state.npcs = state.npcs.filter(n => n.id !== id); save(); refresh();
    },
    async memory(id) {
        const npc = state.npcs.find(n => n.id === id); if (!npc) return;
        const v = await UI.openForm({ title: `Memory for ${npc.name}`, fields: [{ key: 'text', label: 'What does this NPC remember?', type: 'textarea', rows: 4, required: true }] });
        if (!v) return;
        npc.memories.push({ text: v.text.trim(), createdAt: new Date().toISOString() }); save(); refresh();
    },
    async relationship(id) {
        const npc = state.npcs.find(n => n.id === id); if (!npc) return;
        const v = await UI.openForm({ title: `Relationship · ${npc.name}`, fields: [
            { key: 'target', label: 'Target (Player or NPC name)', required: true, value: 'Player' },
            { key: 'type', label: 'Type', type: 'select', options: REL_TYPES.map(t => [t, t]), value: 'acquaintance', half: true },
            { key: 'value', label: 'Value (-100 to 100)', type: 'number', value: 0, min: -100, half: true }] });
        if (!v) return;
        const target = v.target.trim();
        npc.relationships = npc.relationships.filter(r => String(r.target).toLowerCase() !== target.toLowerCase());
        npc.relationships.push({ target, type: v.type, value: Math.max(-100, Math.min(100, num(v.value))) });
        save(); refresh();
    },
    'save-world'() {
        if (!hasChat()) return notify('Open a chat first.', 'warning');
        const cd = activeChatData();
        cd.world.location = $('#kwe-location').val(); cd.world.time = $('#kwe-time').val();
        const event = String($('#kwe-event').val() || '').trim();
        if (event) { cd.memories.push({ text: event, createdAt: new Date().toISOString() }); cd.memories = cd.memories.slice(-100); }
        saveChat(); notify('World data saved'); refresh();
    },
    'save-format'() {
        for (const k of ['header', 'dialogue', 'monologue', 'narration', 'status']) state.format[k] = $(`#kwe-format-${k}`).prop('checked');
        state.language = $('#kwe-language').val(); save(); notify('Narrative settings saved');
    },
    'reset-window'() { UI.resetGeometry(); notify('Window position reset'); },
    'insert-prompt'() { insertIntoChat(buildWorldPrompt(state, activeChatData()), 'RPG context inserted. Review it, then send.'); },
    'insert-protocol'() { insertIntoChat(`${buildWorldPrompt(state, activeChatData())}\n\n${buildMemoryProtocol()}`, 'RPG context + memory protocol inserted. Review it, then send.'); },
    'analyze-chat'() {
        ctx = SillyTavern.getContext();
        const recent = (ctx.chat || []).filter(m => !m.is_system).slice(-12).map(m => `${m.is_user ? 'PLAYER' : 'AI'}: ${String(m.mes || '').slice(0, 2500)}`).join('\n\n');
        if (!recent.trim()) return notify('No recent conversation found in this chat.', 'warning');
        const prompt = `Analyze these recent messages for persistent NPC memories, relationship changes and objective world events. Only use registered NPCs. Do not invent anything. Return the exact <KWE_MEMORY_PROPOSAL> JSON block defined in the protocol. If there are no meaningful changes, say no proposal is needed.\n\nREGISTERED NPCS: ${state.npcs.map(n => n.name).join(', ') || '(none)'}\n\nRECENT CONVERSATION:\n${recent}\n\n${buildMemoryProtocol()}`;
        insertIntoChat(prompt, 'Analysis prompt inserted. Send it to the AI, then review its proposal.');
    },
    async 'reject-proposal'(id) {
        const cd = activeChatData(); cd.pendingMemoryProposals = cd.pendingMemoryProposals.filter(x => x.id !== id);
        saveChat(); notify('Proposal rejected.'); refresh();
    },
    async 'approve-proposal'(id) {
        const pr = findProposal(activeChatData(), id); if (!pr) return;
        if (!await UI.openConfirm({ title: 'Approve proposal', message: 'Write these changes to the NPC and world memory database?', confirmLabel: 'Approve' })) return;
        commitProposal(id);
    },
    async 'edit-proposal'(id) {
        const pr = findProposal(activeChatData(), id); if (!pr) return;
        const fields = [
            ...(pr.memories || []).map((m, i) => ({ key: `m${i}`, label: `Memory · ${m.npcName}`, type: 'textarea', value: m.text })),
            ...(pr.relationships || []).map((r, i) => ({ key: `r${i}`, label: `Affinity · ${r.npcName} → ${r.target} (-20 to 20)`, type: 'number', value: r.delta, min: -20 }))];
        const v = await UI.openForm({ title: 'Edit proposal', fields, submitLabel: 'Save & approve' });
        if (!v) return;
        const live = findProposal(activeChatData(), id); if (!live) return;
        (live.memories || []).forEach((m, i) => { const t = String(v[`m${i}`] ?? '').trim(); if (t) m.text = t; });
        (live.relationships || []).forEach((r, i) => { r.delta = Math.max(-20, Math.min(20, num(v[`r${i}`]))); });
        live.relationships = (live.relationships || []).filter(r => r.delta !== 0);
        commitProposal(id);
    },
    export() {
        const blob = new Blob([JSON.stringify({ settings: state, chat: activeChatData() }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'kimetsu-world-engine-backup.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
};

async function npcForm(old) {
    const v = await UI.openForm({ title: old ? `Edit ${old.name}` : 'Create NPC', fields: [
        { key: 'name', label: 'Character name', value: old?.name || '', required: true },
        { key: 'role', label: 'Role', value: old?.role || '', half: true }, { key: 'breathing', label: 'Breathing style', value: old?.breathing || '', half: true },
        { key: 'personality', label: 'Personality', type: 'textarea', rows: 2, value: old?.personality || '' },
        { key: 'appearance', label: 'Appearance', type: 'textarea', rows: 2, value: old?.appearance || '' },
        { key: 'goals', label: 'Goals', type: 'textarea', rows: 2, value: old?.goals || '' },
        { key: 'secrets', label: 'Secrets', type: 'textarea', rows: 2, value: old?.secrets || '' },
        { key: 'trust', label: 'Trust (0-100)', type: 'number', value: old?.trust ?? 0 }] });
    if (!v) return;
    const data = { name: v.name.trim(), role: v.role.trim(), breathing: v.breathing.trim(), personality: v.personality.trim(), appearance: v.appearance.trim(), goals: v.goals.trim(), secrets: v.secrets.trim(), trust: Math.max(0, Math.min(100, num(v.trust))) };
    if (old) Object.assign(old, data);
    else state.npcs.push({ id: uid(), ...data, memories: [], relationships: [] });
    save(); notify('NPC saved'); refresh();
}

function commitProposal(id) {
    const cd = activeChatData(), pr = findProposal(cd, id); if (!pr) return;
    const result = applyMemoryProposal(state, cd, pr);
    cd.pendingMemoryProposals = cd.pendingMemoryProposals.filter(x => x.id !== id);
    cd.appliedMemoryProposals = [...(cd.appliedMemoryProposals || []), { summary: pr.summary, appliedAt: new Date().toISOString(), result }].slice(-100);
    save(); saveChat();
    notify(`Saved ${result.memories} memories, ${result.relationships} relationship changes and ${result.worldEvents} world events.`);
    refresh();
}

async function handleAction(ev) {
    const el = ev.currentTarget, name = el.getAttribute('data-action'), id = el.getAttribute('data-id') || '';
    const fn = actions[name]; if (!fn) return;
    try { getState(); await fn(id); } catch (error) { console.error(PREFIX, name, error); notify(`Action failed: ${error.message}`, 'error'); }
}

/* ---------------- AI memory proposal detection ---------------- */
function detectProposal(messageId) {
    try {
        getState();
        const cd = activeChatData();
        if (cd.memorySettings?.autoDetect === false) return;
        const chat = ctx.chat || [];
        const msg = (Number.isInteger(messageId) && chat[messageId]) || [...chat].reverse().find(m => !m.is_user && !m.is_system);
        const text = msg?.mes;
        if (typeof text !== 'string' || !text.includes('<KWE_MEMORY_PROPOSAL>')) return;
        const sig = hashText(text);
        if (cd.processedProposalKeys.includes(sig)) return;
        cd.processedProposalKeys = [...cd.processedProposalKeys, sig].slice(-100);
        const proposal = parseMemoryProposal(text, state.npcs);
        if (!proposal) return;
        if (proposal.error) { notify(`AI memory proposal ignored: ${proposal.error}`, 'warning'); saveChat(); return; }
        cd.pendingMemoryProposals = [...cd.pendingMemoryProposals, { ...proposal, id: uid(), createdAt: new Date().toISOString() }].slice(-30);
        saveChat(); notify('New AI memory proposal is ready for review.');
        if (activeTab === 'memory') refresh(); else renderHud();
    } catch (error) { console.warn(PREFIX, 'Memory proposal detection failed', error); }
}

/* ---------------- Mounting ---------------- */
function mountUi() {
    if (document.getElementById('kwe-window')) return;
    const { body } = UI.mountWindow({
        title: `<span class="kwe-kana">鬼滅の刃</span><b>Kimetsu World Engine</b><span class="kwe-version">v${VERSION}</span>`,
        onOpen: () => refresh(),
    });
    body.innerHTML = `<section id="kwe-root" class="kwe"><nav class="kwe-tabs" id="kwe-tabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}">${l}</button>`).join('')}</nav><div class="kwe-view" id="kwe-view"></div></section>`;
    const $root = $('#kwe-root');
    $root.on('click', '[data-tab]', function () { renderTab(String(this.getAttribute('data-tab'))); $('#kwe-view').scrollTop(0); });
    $root.on('click', '[data-goto]', function () { renderTab(String(this.getAttribute('data-goto'))); $('#kwe-view').scrollTop(0); });
    $root.on('click', '[data-action]', handleAction);
    $root.on('change', '#kwe-memory-auto', function () {
        const cd = activeChatData(); cd.memorySettings.autoDetect = this.checked; saveChat();
        notify(this.checked ? 'AI proposal detection enabled' : 'AI proposal detection disabled');
    });
    UI.mountLauncher({ visible: state.ui.launcher !== false, onToggle: () => UI.toggleWindow() });
    renderTab('dashboard');
}

function mountMenuEntries() {
    const $wand = $('#extensionsMenu');
    if ($wand.length && !$('#kwe_wand_container').length) {
        $wand.append(`<div id="kwe_wand_container" class="extension_container interactable" tabindex="0"><div id="kwe_wand_open" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem"><div class="fa-solid fa-dragon extensionsMenuExtensionButton"></div><span>Kimetsu World Engine</span></div></div>`);
        $('#kwe_wand_open').on('click', () => UI.openWindow());
    }
    const $host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if ($host.length && !$('#kwe-settings').length) {
        $host.append(`<div id="kwe-settings" class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Kimetsu World Engine</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
          <div class="inline-drawer-content"><div class="flex-container"><button id="kwe-open-btn" class="menu_button">Open window / เปิดหน้าต่าง</button></div>
          <label class="checkbox_label"><input type="checkbox" class="kwe-launcher-toggle" ${state.ui.launcher !== false ? 'checked' : ''}><span>Show floating 滅 button</span></label></div></div>`);
        $('#kwe-open-btn').on('click', () => UI.openWindow());
    }
}

jQuery(async () => {
    try {
        ctx = SillyTavern.getContext();
        getState();
        mountUi();
        mountMenuEntries();
        $(document).on('change', '.kwe-launcher-toggle', function () {
            getState(); state.ui.launcher = this.checked; save();
            UI.setLauncherVisible(this.checked); $('.kwe-launcher-toggle').prop('checked', this.checked);
        });
        const { eventSource, event_types } = ctx;
        eventSource.on(event_types.APP_READY, () => { mountUi(); mountMenuEntries(); });
        eventSource.on(event_types.CHAT_CHANGED, () => { activeChatData(); refresh(); });
        if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, detectProposal);
        console.info(PREFIX, `v${VERSION} loaded`);
    } catch (error) { console.error(PREFIX, 'Initialization failed', error); }
});
