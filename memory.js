import { uid } from './database.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));

export function buildMemoryProtocol() {
    return `
[KIMETSU WORLD ENGINE — AI MEMORY PROPOSAL PROTOCOL]
At the end of your reply, analyze only clearly established events from the recent conversation.
Do not invent events, emotions, promises, relationships, or memories. Do not infer private thoughts unless explicitly stated.
Return a proposal only when a meaningful persistent change occurred. If nothing meaningful happened, omit the block.
Use exact registered NPC names. Propose small relationship changes (normally -5 to +5; absolute maximum 20).
Do not claim that anything has been saved. The extension will ask the player to review each proposal.

Output exactly one machine-readable block, with no prose inside it:
<KWE_MEMORY_PROPOSAL>
{
  "version": 1,
  "summary": "Short event summary",
  "memories": [
    {
      "npc": "Exact registered NPC name",
      "text": "A concise third-person memory the NPC could reasonably remember",
      "importance": 1,
      "confidence": 0.9,
      "reason": "Why this is a lasting memory"
    }
  ],
  "relationships": [
    {
      "npc": "Exact registered NPC name",
      "target": "Player or exact registered NPC name",
      "type": "friend | rival | ally | family | mentor | enemy | acquaintance | other",
      "delta": 2,
      "reason": "Observable interaction supporting the change"
    }
  ],
  "worldEvents": [
    { "text": "Concise objective event record", "importance": 2 }
  ]
}
</KWE_MEMORY_PROPOSAL>

Rules:
- Only include registered NPCs in memories and relationship changes.
- importance is 1-5; confidence is 0-1.
- relationship delta is an incremental change, not an absolute score.
- A relationship proposal must cite an observable interaction, not a guess.
- Keep each memory atomic and avoid repeating existing memories.
- Never include stat, EXP, item, quest or combat rewards in this protocol.
`;
}

export function parseMemoryProposal(message, registeredNpcs = []) {
    if (typeof message !== 'string') return null;
    const match = message.match(/<KWE_MEMORY_PROPOSAL>\s*([\s\S]*?)\s*<\/KWE_MEMORY_PROPOSAL>/i);
    if (!match) return null;
    let raw;
    try { raw = JSON.parse(match[1]); } catch { return { error: 'Invalid JSON in AI proposal.' }; }
    if (!raw || raw.version !== 1) return { error: 'Unsupported proposal version.' };
    const npcByName = new Map(registeredNpcs.map(n => [String(n.name || '').trim().toLowerCase(), n]));
    const memories = (Array.isArray(raw.memories) ? raw.memories : []).slice(0, 20).flatMap(m => {
        const npc = npcByName.get(String(m.npc || '').trim().toLowerCase());
        const text = String(m.text || '').trim().slice(0, 1200);
        if (!npc || !text) return [];
        return [{ npcId: npc.id, npcName: npc.name, text, importance: clamp(m.importance,1,5), confidence: clamp(m.confidence,0,1), reason: String(m.reason||'').slice(0,500) }];
    });
    const relationships = (Array.isArray(raw.relationships) ? raw.relationships : []).slice(0, 20).flatMap(r => {
        const npc = npcByName.get(String(r.npc || '').trim().toLowerCase());
        const target = String(r.target || '').trim().slice(0,120);
        const targetKnown = target.toLowerCase() === 'player' || npcByName.has(target.toLowerCase());
        const delta = clamp(r.delta,-20,20);
        if (!npc || !target || !targetKnown || !delta) return [];
        return [{ npcId:npc.id, npcName:npc.name, target, type:String(r.type||'acquaintance').slice(0,50), delta, reason:String(r.reason||'').slice(0,500) }];
    });
    const worldEvents = (Array.isArray(raw.worldEvents) ? raw.worldEvents : []).slice(0, 10).flatMap(e => {
        const text = String(e.text || '').trim().slice(0,1200);
        return text ? [{ text, importance:clamp(e.importance,1,5) }] : [];
    });
    if (!memories.length && !relationships.length && !worldEvents.length) return { error: 'Proposal contains no valid changes for registered NPCs or world events.' };
    return { version:1, summary:String(raw.summary||'Conversation update').slice(0,300), memories, relationships, worldEvents };
}

export function isDuplicateMemory(npc, text) {
    const normalized = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    return (npc.memories || []).some(m => {
        const old = String(typeof m === 'string' ? m : m.text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
        return old === normalized || (normalized.length > 30 && (old.includes(normalized) || normalized.includes(old)));
    });
}

export function applyMemoryProposal(state, chatData, proposal) {
    const applied = { memories:0, relationships:0, worldEvents:0, skipped:0 };
    for (const m of proposal.memories || []) {
        const npc = state.npcs.find(n => n.id === m.npcId);
        if (!npc || isDuplicateMemory(npc,m.text)) { applied.skipped++; continue; }
        npc.memories ??= [];
        npc.memories.push({ id:uid(), text:m.text, importance:m.importance, confidence:m.confidence, reason:m.reason, source:'ai-approved', createdAt:new Date().toISOString() });
        applied.memories++;
    }
    for (const r of proposal.relationships || []) {
        const npc = state.npcs.find(n => n.id === r.npcId);
        if (!npc) { applied.skipped++; continue; }
        npc.relationships ??= [];
        const existing = npc.relationships.find(x => String(x.target).toLowerCase() === r.target.toLowerCase());
        if (existing) {
            existing.value = clamp((Number(existing.value)||0)+r.delta,-100,100);
            existing.type = r.type || existing.type;
            existing.updatedAt = new Date().toISOString();
        } else {
            npc.relationships.push({ target:r.target, type:r.type, value:clamp(r.delta,-100,100), updatedAt:new Date().toISOString() });
        }
        applied.relationships++;
    }
    for (const e of proposal.worldEvents || []) {
        const duplicate = (chatData.memories||[]).some(m => String(m.text||'').trim().toLowerCase() === e.text.toLowerCase());
        if (duplicate) { applied.skipped++; continue; }
        chatData.memories ??= [];
        chatData.memories.push({ text:e.text, importance:e.importance, source:'ai-approved', createdAt:new Date().toISOString() });
        applied.worldEvents++;
    }
    return applied;
}
