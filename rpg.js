import { uid } from './database.js';

export function expForNext(level) {
    return Math.floor(100 * Math.pow(Math.max(1, level), 1.35));
}

export function awardExp(player, amount) {
    player.exp = Math.max(0, Number(player.exp) || 0) + Math.max(0, Number(amount) || 0);
    const levelUps = [];
    while (player.exp >= expForNext(player.level)) {
        player.exp -= expForNext(player.level);
        player.level += 1;
        player.skillPoints = (Number(player.skillPoints) || 0) + 1;
        player.maxHp += 12;
        player.maxStamina += 4;
        player.attack += 2;
        player.defense += 1;
        player.hp = player.maxHp;
        player.stamina = player.maxStamina;
        player.expToNext = expForNext(player.level);
        levelUps.push(player.level);
    }
    player.expToNext = expForNext(player.level);
    return levelUps;
}

export function addItem(inventory, item) {
    const existing = inventory.find(x => x.id === item.id);
    if (existing) existing.quantity += item.quantity || 1;
    else inventory.push({ ...item, quantity: item.quantity || 1 });
}

export function useItem(player, itemId) {
    const item = player.inventory.find(x => x.id === itemId && x.quantity > 0);
    if (!item) return { ok: false, message: 'Item unavailable.' };
    if (item.effect === 'heal') player.hp = Math.min(player.maxHp, player.hp + item.value);
    else if (item.effect === 'stamina') player.stamina = Math.min(player.maxStamina, player.stamina + item.value);
    else return { ok: false, message: 'This item has no supported effect.' };
    item.quantity -= 1;
    player.inventory = player.inventory.filter(x => x.quantity > 0);
    return { ok: true, message: `${item.name} used.` };
}

export function makeEnemy(template, playerLevel = 1) {
    const scale = Math.max(0, playerLevel - template.level);
    return {
        id: uid(), templateId: template.id, name: template.name, nameTh: template.nameTh,
        rank: template.rank, level: template.level + scale,
        maxHp: template.hp + scale * 12, hp: template.hp + scale * 12,
        attack: template.attack + scale * 2, defense: template.defense + Math.floor(scale / 2),
        exp: template.exp + scale * 12, reward: template.reward + scale * 8,
        description: template.description
    };
}

export function playerAttack(player, enemy, skillId = null) {
    const skill = skillId ? player.skills.find(s => s.id === skillId) : null;
    const cost = skill ? Number(skill.cost) || 0 : 0;
    if (player.stamina < cost) return { ok: false, message: 'Not enough stamina.' };
    player.stamina -= cost;
    const base = Number(player.attack) + Math.floor(Math.random() * 5);
    const raw = skill ? Math.floor(base * (Number(skill.power) || 1)) : base;
    const damage = Math.max(1, raw - (Number(enemy.defense) || 0));
    enemy.hp = Math.max(0, enemy.hp - damage);
    return { ok: true, damage, defeated: enemy.hp <= 0, skill: skill?.name || 'Basic Attack' };
}

export function enemyAttack(player, enemy) {
    const raw = Number(enemy.attack) + Math.floor(Math.random() * 4);
    const damage = Math.max(1, raw - Math.floor((Number(player.defense) || 0) / 2));
    player.hp = Math.max(0, player.hp - damage);
    return { damage, defeated: player.hp <= 0 };
}
