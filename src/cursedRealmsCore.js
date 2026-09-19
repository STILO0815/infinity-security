const TECHNIQUES = {
  ratio: { id: 'ratio', name: 'Ratio Technique', rarity: 'Common', power: 1.00, move: 'Ratio Strike', domain: null },
  cursed_speech: { id: 'cursed_speech', name: 'Cursed Speech', rarity: 'Rare', power: 1.15, move: 'Don’t Move', domain: null },
  boogie_woogie: { id: 'boogie_woogie', name: 'Boogie Woogie', rarity: 'Rare', power: 1.20, move: 'Position Swap', domain: null },
  blood_manipulation: { id: 'blood_manipulation', name: 'Blood Manipulation', rarity: 'Rare', power: 1.25, move: 'Piercing Blood', domain: null },
  projection: { id: 'projection', name: 'Projection Sorcery', rarity: 'Legendary', power: 1.38, move: 'Frame Rush', domain: null },
  ten_shadows: { id: 'ten_shadows', name: 'Ten Shadows', rarity: 'Legendary', power: 1.48, move: 'Divine Dogs', domain: 'Chimera Shadow Garden' },
  idle_transfiguration: { id: 'idle_transfiguration', name: 'Idle Transfiguration', rarity: 'Legendary', power: 1.52, move: 'Soul Distortion', domain: 'Self-Embodiment of Perfection' },
  disaster_flames: { id: 'disaster_flames', name: 'Disaster Flames', rarity: 'Legendary', power: 1.55, move: 'Maximum Flame', domain: 'Coffin of the Iron Mountain' },
  limitless: { id: 'limitless', name: 'Limitless', rarity: 'Mythic', power: 1.78, move: 'Hollow Purple', domain: 'Unlimited Void' },
  shrine: { id: 'shrine', name: 'Shrine', rarity: 'Mythic', power: 1.82, move: 'Cleave', domain: 'Malevolent Shrine' }
};

const AREAS = [
  { id: 'tokyo_school', name: 'Tokyo School', minLevel: 1, enemies: [
    { name: 'Weak Curse', hp: 130, level: 3, xp: 45, yen: 70 },
    { name: 'Training Curse', hp: 180, level: 8, xp: 70, yen: 100 },
    { name: 'Rogue Sorcerer', hp: 250, level: 15, xp: 110, yen: 145 }
  ], boss: { name: 'Finger Bearer', hp: 1200, level: 35, xp: 850, yen: 1500 } },
  { id: 'abandoned_metro', name: 'Abandoned Metro', minLevel: 50, enemies: [
    { name: 'Tunnel Curse', hp: 700, level: 55, xp: 260, yen: 300 },
    { name: 'Cursed Commuter', hp: 850, level: 70, xp: 320, yen: 380 },
    { name: 'Grade 2 Curse', hp: 1100, level: 90, xp: 410, yen: 470 }
  ], boss: { name: 'Metro Special Curse', hp: 6500, level: 110, xp: 3200, yen: 4500 } },
  { id: 'cursed_hospital', name: 'Cursed Hospital', minLevel: 120, enemies: [
    { name: 'Mutated Curse', hp: 1800, level: 125, xp: 650, yen: 700 },
    { name: 'Ward Phantom', hp: 2300, level: 150, xp: 780, yen: 860 },
    { name: 'Grade 1 Curse', hp: 3100, level: 190, xp: 980, yen: 1050 }
  ], boss: { name: 'Hospital Special Grade', hp: 17000, level: 220, xp: 9200, yen: 10000 } },
  { id: 'shibuya', name: 'Shibuya', minLevel: 250, enemies: [
    { name: 'Transfigured Human', hp: 5200, level: 260, xp: 1550, yen: 1700 },
    { name: 'Disaster Spawn', hp: 6500, level: 300, xp: 1850, yen: 2100 },
    { name: 'Elite Curse User', hp: 8200, level: 350, xp: 2300, yen: 2600 }
  ], boss: { name: 'Shibuya Disaster Curse', hp: 42000, level: 400, xp: 24000, yen: 28000 } },
  { id: 'hidden_temple', name: 'Hidden Temple', minLevel: 450, enemies: [
    { name: 'Barrier Guardian', hp: 12000, level: 460, xp: 3400, yen: 3800 },
    { name: 'Ancient Curse', hp: 15000, level: 520, xp: 4100, yen: 4500 },
    { name: 'Heian Sorcerer', hp: 19000, level: 600, xp: 5000, yen: 5600 }
  ], boss: { name: 'Temple Calamity', hp: 90000, level: 650, xp: 52000, yen: 60000 } },
  { id: 'culling_zone', name: 'Culling Zone', minLevel: 700, enemies: [
    { name: 'Reincarnated Sorcerer', hp: 28000, level: 720, xp: 7200, yen: 8000 },
    { name: 'Colony Hunter', hp: 35000, level: 800, xp: 8500, yen: 9500 },
    { name: 'Special Grade Player', hp: 43000, level: 900, xp: 10000, yen: 11500 }
  ], boss: { name: 'Colony Apex', hp: 180000, level: 980, xp: 90000, yen: 100000 } },
  { id: 'prison_realm', name: 'Prison Realm', minLevel: 1050, enemies: [
    { name: 'Sealed Abomination', hp: 58000, level: 1080, xp: 14000, yen: 15500 },
    { name: 'Void Curse', hp: 72000, level: 1200, xp: 17000, yen: 19000 },
    { name: 'Special Grade Entity', hp: 90000, level: 1350, xp: 21000, yen: 23000 }
  ], boss: { name: 'Prison Realm Sovereign', hp: 360000, level: 1450, xp: 170000, yen: 190000 } },
  { id: 'limitless_void', name: 'Limitless Void', minLevel: 1500, enemies: [
    { name: 'Abyssal Curse', hp: 125000, level: 1520, xp: 30000, yen: 33000 },
    { name: 'Domain Eater', hp: 155000, level: 1650, xp: 36000, yen: 40000 },
    { name: 'Ancient Special Grade', hp: 195000, level: 1800, xp: 43000, yen: 48000 }
  ], boss: { name: 'King of Curses Echo', hp: 750000, level: 2000, xp: 350000, yen: 400000 } }
];

const TOOLS = [
  { id: 'slaughter_blade', name: 'Slaughter Blade', rarity: 'Rare', power: 1.08 },
  { id: 'black_rope', name: 'Black Rope', rarity: 'Legendary', power: 1.16 },
  { id: 'playful_cloud', name: 'Playful Cloud', rarity: 'Legendary', power: 1.22 },
  { id: 'inverted_spear', name: 'Inverted Spear', rarity: 'Mythic', power: 1.32 }
];

const RARITY = { Common: 0, Rare: 1, Legendary: 2, Mythic: 3 };

function xpNeeded(level) {
  return Math.floor(90 + Math.pow(level, 1.28) * 42);
}

function gradeFor(profile) {
  const l = profile.level || 1;
  if (l >= 1000 && (profile.mastery || 0) >= 150) return 'Special Grade';
  if (l >= 500) return 'Grade 1';
  if (l >= 300) return 'Semi Grade 1';
  if (l >= 150) return 'Grade 2';
  if (l >= 60) return 'Grade 3';
  return 'Grade 4';
}

function defaultProfile(userId) {
  return {
    userId,
    level: 1,
    xp: 0,
    yen: 2500,
    hp: 300,
    maxHp: 300,
    cursedEnergy: 180,
    maxCursedEnergy: 180,
    areaId: 'tokyo_school',
    techniqueId: 'ratio',
    mastery: 0,
    techniquePity: 0,
    domainFragments: 0,
    techniqueShards: 0,
    inventory: [],
    equippedToolId: null,
    activeQuest: null,
    stats: { wins: 0, losses: 0, kills: 0, bosses: 0, blackFlashes: 0, raidDamage: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function currentArea(profile) {
  return AREAS.find(a => a.id === profile.areaId) || AREAS[0];
}

function unlockedAreas(profile) {
  return AREAS.filter(a => profile.level >= a.minLevel);
}

function addRewards(profile, xp, yen) {
  profile.xp += Math.max(0, Math.floor(xp));
  profile.yen += Math.max(0, Math.floor(yen));
  let levels = 0;
  while (profile.xp >= xpNeeded(profile.level)) {
    profile.xp -= xpNeeded(profile.level);
    profile.level += 1;
    levels += 1;
    profile.maxHp += 18 + Math.floor(profile.level * 0.8);
    profile.maxCursedEnergy += 8 + Math.floor(profile.level * 0.35);
    profile.hp = profile.maxHp;
    profile.cursedEnergy = profile.maxCursedEnergy;
  }
  profile.updatedAt = Date.now();
  return levels;
}

function rollTechnique(profile, rng = Math.random) {
  const cost = 7500;
  if (profile.yen < cost) return { ok: false, reason: 'yen', cost };
  profile.yen -= cost;
  profile.techniquePity = (profile.techniquePity || 0) + 1;

  let rarity;
  const r = rng();
  if (profile.techniquePity >= 40) rarity = 'Mythic';
  else if (profile.techniquePity >= 20 && r < 0.45) rarity = 'Legendary';
  else if (r < 0.04) rarity = 'Mythic';
  else if (r < 0.17) rarity = 'Legendary';
  else if (r < 0.45) rarity = 'Rare';
  else rarity = 'Common';

  const options = Object.values(TECHNIQUES).filter(t => t.rarity === rarity);
  const rolled = options[Math.floor(rng() * options.length)] || TECHNIQUES.ratio;
  const previous = TECHNIQUES[profile.techniqueId];

  if (rarity === 'Mythic') profile.techniquePity = 0;
  profile.techniqueId = rolled.id;
  profile.mastery = Math.max(0, Math.floor((profile.mastery || 0) * 0.20));
  profile.updatedAt = Date.now();

  return { ok: true, technique: rolled, previous, cost, pity: profile.techniquePity };
}

function combatPower(profile) {
  const technique = TECHNIQUES[profile.techniqueId] || TECHNIQUES.ratio;
  const tool = TOOLS.find(t => t.id === profile.equippedToolId);
  const toolPower = tool?.power || 1;
  return (35 + profile.level * 2.2 + profile.mastery * 0.45) * technique.power * toolPower;
}

function m1Damage(profile, rng = Math.random) {
  const variance = 0.88 + rng() * 0.24;
  return Math.max(10, Math.floor(combatPower(profile) * 0.72 * variance));
}

function techniqueDamage(profile, rng = Math.random) {
  const variance = 0.90 + rng() * 0.22;
  return Math.max(20, Math.floor(combatPower(profile) * 1.55 * variance));
}

function domainDamage(profile, rng = Math.random) {
  const technique = TECHNIQUES[profile.techniqueId] || TECHNIQUES.ratio;
  if (!technique.domain || profile.mastery < 150) return 0;
  return Math.max(100, Math.floor(combatPower(profile) * (3.2 + rng() * 0.8)));
}

function enemyCounterDamage(profile, enemy, blocking = false, dodging = false, rng = Math.random) {
  if (dodging && rng() < 0.58) return 0;
  let damage = Math.floor(18 + enemy.level * 1.55 + rng() * (15 + enemy.level * 0.25));
  if (blocking) damage = Math.floor(damage * 0.42);
  return Math.max(1, damage);
}

function startQuest(profile) {
  const area = currentArea(profile);
  const enemy = area.enemies[Math.min(area.enemies.length - 1, Math.floor((profile.level - area.minLevel) / Math.max(1, (area.enemies.length * 15))))] || area.enemies[0];
  const target = 4 + Math.min(6, Math.floor(profile.level / 250));
  profile.activeQuest = {
    areaId: area.id,
    enemyName: enemy.name,
    target,
    kills: 0,
    rewardXp: enemy.xp * target * 2,
    rewardYen: enemy.yen * target * 2
  };
  return profile.activeQuest;
}

function applyQuestKill(profile, enemyName) {
  const q = profile.activeQuest;
  if (!q || q.enemyName !== enemyName || q.areaId !== profile.areaId) return { progressed: false };
  q.kills += 1;
  if (q.kills < q.target) return { progressed: true, completed: false, quest: q };
  const levels = addRewards(profile, q.rewardXp, q.rewardYen);
  profile.activeQuest = null;
  return { progressed: true, completed: true, levels, rewardXp: q.rewardXp, rewardYen: q.rewardYen };
}

function dropFromBoss(profile, rng = Math.random) {
  const r = rng();
  if (r < 0.04) {
    const tool = TOOLS[3];
    if (!profile.inventory.includes(tool.id)) profile.inventory.push(tool.id);
    return { type: 'tool', item: tool };
  }
  if (r < 0.14) {
    const tool = TOOLS[2];
    if (!profile.inventory.includes(tool.id)) profile.inventory.push(tool.id);
    return { type: 'tool', item: tool };
  }
  if (r < 0.32) {
    const tool = TOOLS[1];
    if (!profile.inventory.includes(tool.id)) profile.inventory.push(tool.id);
    return { type: 'tool', item: tool };
  }
  if (r < 0.55) {
    profile.domainFragments += 1;
    return { type: 'domain_fragment', amount: 1 };
  }
  profile.techniqueShards += 2;
  return { type: 'technique_shards', amount: 2 };
}

function technique(profile) {
  return TECHNIQUES[profile.techniqueId] || TECHNIQUES.ratio;
}

module.exports = {
  TECHNIQUES, AREAS, TOOLS, RARITY,
  xpNeeded, gradeFor, defaultProfile, currentArea, unlockedAreas, addRewards,
  rollTechnique, combatPower, m1Damage, techniqueDamage, domainDamage,
  enemyCounterDamage, startQuest, applyQuestKill, dropFromBoss, technique
};
