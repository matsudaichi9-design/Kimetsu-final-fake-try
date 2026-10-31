export function uid() {
    try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* insecure context (plain http) */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export function createDefaultState() {
    return {
        schemaVersion: 3,
        ui: { launcher: true },
        npcs: [],
        language: 'both',
        format: { header: true, dialogue: true, monologue: true, narration: true, status: true },
        player: {
            name: 'Demon Slayer', rank: 'Mizunoto', level: 1, exp: 0, expToNext: 100,
            hp: 100, maxHp: 100, attack: 12, defense: 5, speed: 10, stamina: 30, maxStamina: 30,
            breathing: 'Water Breathing', money: 0, skillPoints: 0,
            skills: [
                { id: 'water-1', name: 'Water Surface Slash', nameTh: 'ปราณวารี กระบวนท่าที่หนึ่ง: ผิวน้ำ', type: 'attack', power: 1.5, cost: 5, description: 'A focused opening slash.' }
            ],
            inventory: [
                { id: 'bandage', name: 'Bandage', nameTh: 'ผ้าพันแผล', type: 'consumable', quantity: 3, effect: 'heal', value: 25 },
                { id: 'riceball', name: 'Rice Ball', nameTh: 'ข้าวปั้น', type: 'consumable', quantity: 2, effect: 'stamina', value: 15 }
            ]
        },
        missions: [],
        enemyTemplates: [
            { id: 'lesser-demon', name: 'Lesser Demon', nameTh: 'อสูรระดับล่าง', rank: 'Common', level: 1, hp: 55, attack: 8, defense: 2, exp: 35, reward: 20, description: 'A newly turned demon.' },
            { id: 'strong-demon', name: 'Strong Demon', nameTh: 'อสูรแข็งแกร่ง', rank: 'Elite', level: 3, hp: 115, attack: 15, defense: 5, exp: 90, reward: 70, description: 'A dangerous demon with combat experience.' },
            { id: 'lower-moon', name: 'Lower Moon', nameTh: 'ข้างแรม', rank: 'Boss', level: 6, hp: 260, attack: 24, defense: 9, exp: 260, reward: 250, description: 'A member of the Twelve Kizuki.' }
        ]
    };
}

export function normalizeState(input = {}) {
    const d = createDefaultState();
    const player = { ...d.player, ...(input.player || {}) };
    player.skills = Array.isArray(player.skills) ? player.skills : d.player.skills;
    player.inventory = Array.isArray(player.inventory) ? player.inventory : d.player.inventory;
    player.hp = Math.max(0, Math.min(Number(player.hp) || 0, Number(player.maxHp) || 1));
    player.stamina = Math.max(0, Math.min(Number(player.stamina) || 0, Number(player.maxStamina) || 1));
    return {
        ...d, ...input, schemaVersion: 3, player,
        ui: { ...d.ui, ...(input.ui || {}) },
        npcs: Array.isArray(input.npcs) ? input.npcs.map(n => ({
            id: n.id || uid(), name: String(n.name || 'Unnamed NPC'),
            role: String(n.role || ''), personality: String(n.personality || ''),
            appearance: String(n.appearance || ''), breathing: String(n.breathing || ''),
            goals: String(n.goals || ''), secrets: String(n.secrets || ''),
            trust: Math.max(0, Math.min(100, Number(n.trust) || 0)),
            memories: Array.isArray(n.memories) ? n.memories : [],
            relationships: Array.isArray(n.relationships) ? n.relationships : []
        })) : [],
        missions: Array.isArray(input.missions) ? input.missions : [],
        enemyTemplates: Array.isArray(input.enemyTemplates) ? input.enemyTemplates : d.enemyTemplates,
        format: { ...d.format, ...(input.format || {}) }
    };
}
