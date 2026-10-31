export function buildWorldPrompt(state, chatData = {}) {
    const p = state.player || {};
    const f = state.format || {};
    const npcLines = (state.npcs || []).map(n => {
        const memories = (n.memories || []).slice(-8).map(m => `- ${m.text}`).join('\n') || '- No recorded memories';
        const relations = (n.relationships || []).map(r => `${r.target}: ${r.type} (${r.value ?? 0})`).join('; ') || 'Not defined';
        return `### ${n.name}\nRole: ${n.role}\nPersonality: ${n.personality}\nAppearance: ${n.appearance}\nBreathing: ${n.breathing}\nGoals: ${n.goals}\nSecrets: ${n.secrets}\nTrust: ${n.trust}/100\nRelationships: ${relations}\nMemories:\n${memories}`;
    }).join('\n\n');
    const sections = [
        f.header && 'CHARACTER HEADER: Show active character, role, location, time, and relevant relationship.',
        f.dialogue && 'DIALOGUE: Make each speaker clear; do not mix spoken words with thoughts.',
        f.monologue && 'MONOLOGUE: Use italics for internal thoughts. Never present thoughts as spoken dialogue.',
        f.narration && 'NARRATION: Describe action, atmosphere, and consequences with continuity.',
        f.status && 'STATUS: Show a concise status footer when useful. Never invent changed stats.'
    ].filter(Boolean).join('\n');
    const missions = (state.missions || []).map(m => `- ${m.title} [${m.status}] ${m.description}`).join('\n');
    const combat = chatData.combat?.active
        ? `Active enemy: ${chatData.combat.enemy.name} (${chatData.combat.enemy.hp}/${chatData.combat.enemy.maxHp} HP). Combat log: ${(chatData.combat.log || []).slice(-5).join(' | ')}`
        : 'No active combat encounter.';
    return `[KIMETSU WORLD ENGINE RPG — ${state.language || 'both'}]
Use this as continuity and game-state data. Do not repeat it verbatim. Never control the player's decisions, dialogue, or inner thoughts.

PLAYER
Name: ${p.name}; Rank: ${p.rank}; Level: ${p.level}; EXP: ${p.exp}/${p.expToNext}
HP: ${p.hp}/${p.maxHp}; Stamina: ${p.stamina}/${p.maxStamina}
Attack: ${p.attack}; Defense: ${p.defense}; Speed: ${p.speed}; Skill points: ${p.skillPoints}
Breathing: ${p.breathing}; Inventory: ${(p.inventory || []).map(i => `${i.name} x${i.quantity}`).join(', ')}

WORLD
Location: ${chatData.world?.location || 'Unknown'}; Time: ${chatData.world?.time || 'Unknown'}
${combat}

MISSIONS
${missions || 'No registered missions.'}

REGISTERED NPCS
${npcLines || 'No custom NPCs registered.'}

RECENT MEMORIES
${(chatData.memories || []).slice(-12).map(m => `- ${m.text}`).join('\n') || 'No chat memories recorded.'}

NARRATIVE FORMAT
${sections}

RPG RULES
Respect the numeric state above. Do not grant EXP, items, level-ups, victories, or stat changes unless the user explicitly performs the action or the extension state records it. Resolve combat outcomes consistently with HP and stamina. NPCs have independent motives, knowledge limits, and memories. Trust changes gradually. Keep secrets private until plausibly discovered.`;
}
