const path = require('path');
const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { loadJson, saveJson } = require('../security/jsonStore');
const core = require('./cursedRealmsCore');

const FILE = path.join(__dirname, '..', '..', 'data', 'games', 'cursedRealms.json');
let data = loadJson(FILE, { guilds: {} });
const combats = new Map();
const duels = new Map();
const duelCooldown = new Map();

function save() {
  saveJson(FILE, data);
}

function guildData(guildId) {
  data.guilds[guildId] ||= { profiles: {}, raid: null };
  data.guilds[guildId].profiles ||= {};
  return data.guilds[guildId];
}

function getProfile(guildId, userId) {
  const g = guildData(guildId);
  g.profiles[userId] ||= core.defaultProfile(userId);
  const p = g.profiles[userId];
  p.stats ||= { wins: 0, losses: 0, kills: 0, bosses: 0, blackFlashes: 0, raidDamage: 0 };
  p.inventory ||= [];
  p.domainFragments ||= 0;
  p.techniqueShards ||= 0;
  p.techniquePity ||= 0;
  p.mastery ||= 0;
  p.areaId ||= 'tokyo_school';
  p.techniqueId ||= 'ratio';
  return p;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function bar(value, max, size = 10) {
  const ratio = max <= 0 ? 0 : clamp(value / max, 0, 1);
  const full = Math.round(ratio * size);
  return `${'█'.repeat(full)}${'░'.repeat(size - full)}`;
}

function rarityEmoji(rarity) {
  return rarity === 'Mythic' ? '💠' : rarity === 'Legendary' ? '🟣' : rarity === 'Rare' ? '🔵' : '⚪';
}

function gameAura(type) {
  const lines = {
    home: [
      'Cursed energy detected. The grind begins.',
      'Six Eyes opened the gate to Cursed Realms.',
      'Another sorcerer entered the field. Try not to get folded.'
    ],
    win: [
      'Curse exorcised. Clean work.',
      'That curse picked the wrong sorcerer.',
      'Six Eyes approved that one.'
    ],
    boss: [
      'Special-grade pressure detected.',
      'This one actually has aura. Good luck.',
      'The barrier is shaking. Boss fight started.'
    ],
    roll: [
      'Cursed technique resonance detected…',
      'The wheel of cursed energy is turning…',
      'Technique imprint incoming…'
    ],
    black: [
      'BLACK FLASH. Timing beyond normal cursed energy.',
      'The sparks of black chose you.',
      'Six Eyes caught the exact frame.'
    ],
    domain: [
      'DOMAIN EXPANSION.',
      'Barrier complete. Reality just changed.',
      'The battlefield belongs to your technique now.'
    ],
    raid: [
      'A Special Grade has entered the server domain.',
      'Server-wide cursed pressure is spiking.',
      'Everybody wanted a raid. Now survive it.'
    ]
  };
  const set = lines[type] || lines.home;
  return set[Math.floor(Math.random() * set.length)];
}

function mainEmbed(profile, username) {
  const area = core.currentArea(profile);
  const tech = core.technique(profile);
  const needed = core.xpNeeded(profile.level);
  return new EmbedBuilder()
    .setTitle('👁️ CURSED REALMS')
    .setDescription(
      `**${gameAura('home')}**\n\n` +
      `**${username}** • Lv. **${profile.level}** • **${core.gradeFor(profile)}**\n` +
      `📍 **${area.name}**\n` +
      `${rarityEmoji(tech.rarity)} **${tech.name}** • Mastery **${profile.mastery}**\n\n` +
      `❤️ ${bar(profile.hp, profile.maxHp)} ${profile.hp}/${profile.maxHp}\n` +
      `⚡ ${bar(profile.cursedEnergy, profile.maxCursedEnergy)} ${profile.cursedEnergy}/${profile.maxCursedEnergy}\n` +
      `✨ ${bar(profile.xp, needed)} ${profile.xp}/${needed} XP\n\n` +
      `💴 **${profile.yen.toLocaleString()} Yen** • 🌀 **${profile.domainFragments} Domain Fragments**`
    )
    .setColor(0x7dd3fc)
    .setFooter({ text: 'Cursed Realms • Progress is server-specific • no paid rolls' });
}

function mainRows(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_fight_${userId}`).setLabel('Fight').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cr_quest_${userId}`).setLabel('Quest').setEmoji('📜').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cr_boss_${userId}`).setLabel('Boss').setEmoji('👹').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cr_raid_${userId}`).setLabel('Raid').setEmoji('🚨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cr_roll_${userId}`).setLabel('Technique Roll').setEmoji('🎲').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_tech_${userId}`).setLabel('Technique').setEmoji('🧬').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cr_inventory_${userId}`).setLabel('Inventory').setEmoji('🎒').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cr_travel_${userId}`).setLabel('Travel').setEmoji('🗺️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cr_stats_${userId}`).setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cr_heal_${userId}`).setLabel('Recover').setEmoji('💚').setStyle(ButtonStyle.Success)
    )
  ];
}

function verifyOwner(interaction, expectedUserId) {
  if (interaction.user.id === expectedUserId) return true;
  interaction.reply({ content: '👁️ This Cursed Realms panel belongs to someone else.', ephemeral: true }).catch(() => {});
  return false;
}

async function openMain(interaction) {
  const p = getProfile(interaction.guild.id, interaction.user.id);
  save();
  const payload = { embeds: [mainEmbed(p, interaction.user.username)], components: mainRows(interaction.user.id), ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

function combatKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function makeEnemy(profile, boss = false) {
  const area = core.currentArea(profile);
  const template = boss
    ? area.boss
    : (profile.activeQuest && profile.activeQuest.areaId === area.id
      ? area.enemies.find(e => e.name === profile.activeQuest.enemyName) || area.enemies[Math.floor(Math.random() * area.enemies.length)]
      : area.enemies[Math.floor(Math.random() * area.enemies.length)]);
  return { ...template, maxHp: template.hp, hp: template.hp, boss };
}

function combatEmbed(profile, combat, note = '') {
  const tech = core.technique(profile);
  const enemy = combat.enemy;
  const blackReady = combat.blackFlashExpires && combat.blackFlashExpires > Date.now();
  return new EmbedBuilder()
    .setTitle(`${enemy.boss ? '👹 BOSS' : '⚔️ BATTLE'} • ${enemy.name}`)
    .setDescription(
      `${note ? `${note}\n\n` : ''}` +
      `**${enemy.name} • Lv.${enemy.level}**\n` +
      `❤️ ${bar(enemy.hp, enemy.maxHp, 12)} ${Math.max(0, enemy.hp)}/${enemy.maxHp}\n\n` +
      `**YOU • Lv.${profile.level}**\n` +
      `❤️ ${bar(combat.playerHp, profile.maxHp, 12)} ${Math.max(0, combat.playerHp)}/${profile.maxHp}\n` +
      `⚡ ${bar(combat.playerCe, profile.maxCursedEnergy, 12)} ${Math.max(0, combat.playerCe)}/${profile.maxCursedEnergy}\n\n` +
      `${rarityEmoji(tech.rarity)} **${tech.name}** • M${profile.mastery}` +
      (blackReady ? `\n\n⚫⚡ **BLACK FLASH WINDOW OPEN — HIT NOW!**` : '')
    )
    .setColor(enemy.boss ? 0xff3b30 : (blackReady ? 0x111111 : 0x7dd3fc))
    .setFooter({ text: enemy.boss ? gameAura('boss') : 'M1 builds pressure • Technique uses CE • Black Flash is timing-based' });
}

function combatRows(profile, combat, userId) {
  const tech = core.technique(profile);
  const blackReady = combat.blackFlashExpires && combat.blackFlashExpires > Date.now();
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_m1_${userId}`).setLabel('M1').setEmoji('👊').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`cr_ct_${userId}`).setLabel(tech.move).setEmoji('🧬').setStyle(ButtonStyle.Danger).setDisabled(combat.playerCe < 35),
      new ButtonBuilder().setCustomId(`cr_block_${userId}`).setLabel('Block').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cr_dodge_${userId}`).setLabel('Dodge').setEmoji('💨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cr_black_${userId}`).setLabel('BLACK FLASH').setEmoji('⚫').setStyle(ButtonStyle.Success).setDisabled(!blackReady)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_domain_${userId}`).setLabel(tech.domain || 'Domain Locked').setEmoji('🌀').setStyle(ButtonStyle.Danger).setDisabled(!tech.domain || profile.mastery < 150 || combat.playerCe < 100 || combat.domainUsed),
      new ButtonBuilder().setCustomId(`cr_run_${userId}`).setLabel('Run').setEmoji('🏃').setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function startCombat(interaction, boss = false) {
  const profile = getProfile(interaction.guild.id, interaction.user.id);
  const enemy = makeEnemy(profile, boss);
  const combat = {
    enemy,
    playerHp: profile.hp,
    playerCe: profile.cursedEnergy,
    blackFlashExpires: 0,
    domainUsed: false,
    startedAt: Date.now()
  };
  combats.set(combatKey(interaction.guild.id, interaction.user.id), combat);
  const payload = { embeds: [combatEmbed(profile, combat, boss ? `**${gameAura('boss')}**` : '')], components: combatRows(profile, combat, interaction.user.id), ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function finishCombat(interaction, profile, combat, won) {
  const enemy = combat.enemy;
  if (!won) {
    profile.stats.losses += 1;
    const lost = Math.min(profile.yen, Math.floor(profile.yen * 0.05));
    profile.yen -= lost;
    profile.hp = profile.maxHp;
    profile.cursedEnergy = profile.maxCursedEnergy;
    combats.delete(combatKey(interaction.guild.id, interaction.user.id));
    save();
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('☠️ YOU WERE EXORCISED').setDescription(`**${enemy.name}** dropped you.\n\nLost: 💴 **${lost} Yen**\nYou recovered at full HP.\n\n*Six Eyes note: maybe block next time.*`).setColor(0x8b0000)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cr_home_${interaction.user.id}`).setLabel('Back to Cursed Realms').setEmoji('👁️').setStyle(ButtonStyle.Primary))]
    });
  }

  const xp = enemy.xp * (enemy.boss ? 1 : 1);
  const yen = enemy.yen;
  const levels = core.addRewards(profile, xp, yen);
  profile.stats.wins += 1;
  profile.stats.kills += 1;
  if (enemy.boss) profile.stats.bosses += 1;
  profile.hp = Math.max(1, combat.playerHp);
  profile.cursedEnergy = Math.max(0, combat.playerCe);

  const quest = core.applyQuestKill(profile, enemy.name);
  let drop = null;
  if (enemy.boss) drop = core.dropFromBoss(profile);
  combats.delete(combatKey(interaction.guild.id, interaction.user.id));
  save();

  let extra = levels ? `\n⬆️ **LEVEL UP x${levels}!** Now Lv.${profile.level}` : '';
  if (quest.completed) extra += `\n📜 **QUEST COMPLETE:** +${quest.rewardXp} XP • +${quest.rewardYen.toLocaleString()} Yen`;
  else if (quest.progressed) extra += `\n📜 Quest: **${quest.quest.kills}/${quest.quest.target} ${quest.quest.enemyName}**`;
  if (drop?.type === 'tool') extra += `\n🎁 **${rarityEmoji(drop.item.rarity)} DROP: ${drop.item.name}**`;
  if (drop?.type === 'domain_fragment') extra += `\n🌀 **DROP: Domain Fragment x${drop.amount}**`;
  if (drop?.type === 'technique_shards') extra += `\n🧬 **DROP: Technique Shards x${drop.amount}**`;

  return interaction.update({
    embeds: [new EmbedBuilder().setTitle(enemy.boss ? '👑 BOSS EXORCISED' : '✅ CURSE EXORCISED').setDescription(`**${gameAura('win')}**\n\n+✨ **${xp.toLocaleString()} XP**\n+💴 **${yen.toLocaleString()} Yen**${extra}`).setColor(0x57f287)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_fight_${interaction.user.id}`).setLabel('Fight Again').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cr_home_${interaction.user.id}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Primary)
    )]
  });
}

async function combatAction(interaction, action, userId) {
  if (!verifyOwner(interaction, userId)) return true;
  const profile = getProfile(interaction.guild.id, userId);
  const combat = combats.get(combatKey(interaction.guild.id, userId));
  if (!combat) {
    await interaction.reply({ content: 'That battle expired. Start a new fight.', ephemeral: true });
    return true;
  }

  let note = '';
  let enemyGetsTurn = true;
  if (action === 'run') {
    profile.hp = Math.max(1, combat.playerHp);
    profile.cursedEnergy = Math.max(0, combat.playerCe);
    combats.delete(combatKey(interaction.guild.id, userId));
    save();
    await interaction.update({ embeds: [mainEmbed(profile, interaction.user.username)], components: mainRows(userId) });
    return true;
  }

  if (action === 'm1') {
    const dmg = core.m1Damage(profile);
    combat.enemy.hp -= dmg;
    combat.playerCe = clamp(combat.playerCe + 10, 0, profile.maxCursedEnergy);
    note = `👊 M1 dealt **${dmg}** damage.`;
    if (Math.random() < 0.14) {
      combat.blackFlashExpires = Date.now() + 4500;
      note += `\n⚫ **BLACK FLASH WINDOW! You have ~4 seconds.**`;
    }
  } else if (action === 'ct') {
    if (combat.playerCe < 35) note = '⚡ Not enough cursed energy.';
    else {
      combat.playerCe -= 35;
      const dmg = core.techniqueDamage(profile);
      combat.enemy.hp -= dmg;
      profile.mastery += 2;
      note = `🧬 **${core.technique(profile).move}** dealt **${dmg}** damage. +2 Mastery`;
    }
  } else if (action === 'black') {
    if (!combat.blackFlashExpires || Date.now() > combat.blackFlashExpires) {
      combat.blackFlashExpires = 0;
      note = '⚫ Too late. The Black Flash window vanished.';
    } else {
      const dmg = Math.floor(core.m1Damage(profile) * 2.5);
      combat.enemy.hp -= dmg;
      combat.blackFlashExpires = 0;
      profile.mastery += 5;
      profile.stats.blackFlashes += 1;
      note = `⚫⚡ **BLACK FLASH — ${dmg} DAMAGE!**\n**${gameAura('black')}** +5 Mastery`;
      enemyGetsTurn = false;
    }
  } else if (action === 'domain') {
    const tech = core.technique(profile);
    const dmg = core.domainDamage(profile);
    if (!dmg || combat.playerCe < 100 || combat.domainUsed) note = '🌀 Your Domain is not ready.';
    else {
      combat.playerCe -= 100;
      combat.domainUsed = true;
      combat.enemy.hp -= dmg;
      profile.mastery += 8;
      note = `🌀 **DOMAIN EXPANSION: ${tech.domain}**\n${gameAura('domain')}\n**${dmg} DAMAGE** • +8 Mastery`;
      enemyGetsTurn = false;
    }
  } else if (action === 'block') {
    const taken = core.enemyCounterDamage(profile, combat.enemy, true, false);
    combat.playerHp -= taken;
    combat.playerCe = clamp(combat.playerCe + 18, 0, profile.maxCursedEnergy);
    note = `🛡️ Blocked the hit. Took **${taken}** damage and recovered CE.`;
    enemyGetsTurn = false;
  } else if (action === 'dodge') {
    const taken = core.enemyCounterDamage(profile, combat.enemy, false, true);
    combat.playerHp -= taken;
    combat.playerCe = clamp(combat.playerCe + 12, 0, profile.maxCursedEnergy);
    note = taken === 0 ? '💨 **PERFECT DODGE.** No damage.' : `💨 Dodge failed — took **${taken}** damage.`;
    enemyGetsTurn = false;
  }

  if (combat.enemy.hp <= 0) return finishCombat(interaction, profile, combat, true);

  if (enemyGetsTurn) {
    const taken = core.enemyCounterDamage(profile, combat.enemy, false, false);
    combat.playerHp -= taken;
    note += `\n👹 ${combat.enemy.name} hit back for **${taken}**.`;
  }

  if (combat.playerHp <= 0) return finishCombat(interaction, profile, combat, false);

  profile.hp = combat.playerHp;
  profile.cursedEnergy = combat.playerCe;
  save();
  await interaction.update({ embeds: [combatEmbed(profile, combat, note)], components: combatRows(profile, combat, userId) });
  return true;
}

function questEmbed(profile) {
  const q = profile.activeQuest;
  if (!q) {
    const area = core.currentArea(profile);
    return new EmbedBuilder().setTitle('📜 QUEST BOARD').setDescription(`📍 **${area.name}**\n\nNo active quest. Accept a hunt quest and exorcise curses for boosted XP + Yen.`).setColor(0x5865f2);
  }
  return new EmbedBuilder().setTitle('📜 ACTIVE QUEST').setDescription(
    `**Exorcise ${q.target}× ${q.enemyName}**\nProgress: **${q.kills}/${q.target}**\n\nReward:\n✨ **${q.rewardXp.toLocaleString()} XP**\n💴 **${q.rewardYen.toLocaleString()} Yen**`
  ).setColor(0x5865f2);
}

function techniqueEmbed(profile) {
  const t = core.technique(profile);
  return new EmbedBuilder().setTitle(`🧬 ${t.name}`).setDescription(
    `${rarityEmoji(t.rarity)} Rarity: **${t.rarity}**\nMastery: **${profile.mastery}**\nMain Move: **${t.move}**\n` +
    `Domain: **${t.domain || 'No Domain — technique awakening only'}**\n\n` +
    `Technique attacks gain Mastery. Domains unlock at **150 Mastery** when the technique has one.\n` +
    `🎲 Roll cost: **7,500 Yen**\n💠 Mythic base chance: **4%** • hard Mythic pity at **40 rolls**\n` +
    `Current pity: **${profile.techniquePity}/40**`
  ).setColor(t.rarity === 'Mythic' ? 0xe879f9 : t.rarity === 'Legendary' ? 0x8b5cf6 : 0x60a5fa);
}

function inventoryEmbed(profile) {
  const items = profile.inventory.map(id => core.TOOLS.find(t => t.id === id)).filter(Boolean);
  const equipped = core.TOOLS.find(t => t.id === profile.equippedToolId);
  return new EmbedBuilder().setTitle('🎒 CURSED INVENTORY').setDescription(
    `Equipped: **${equipped ? equipped.name : 'None'}**\n` +
    `🌀 Domain Fragments: **${profile.domainFragments}**\n🧬 Technique Shards: **${profile.techniqueShards}**\n\n` +
    (items.length ? items.map(i => `${rarityEmoji(i.rarity)} **${i.name}** • x${i.power.toFixed(2)} power`).join('\n') : '*No cursed tools yet. Bosses can drop them.*')
  ).setColor(0xf59e0b);
}

function statsEmbed(profile) {
  const s = profile.stats;
  return new EmbedBuilder().setTitle('📊 SORCERER PROFILE').setDescription(
    `Lv. **${profile.level}** • **${core.gradeFor(profile)}**\n` +
    `⚔️ Wins: **${s.wins}** • ☠️ Losses: **${s.losses}**\n` +
    `👹 Curses Exorcised: **${s.kills}** • Bosses: **${s.bosses}**\n` +
    `⚫ Black Flashes: **${s.blackFlashes}**\n🚨 Raid Damage: **${s.raidDamage.toLocaleString()}**\n` +
    `🧬 Mastery: **${profile.mastery}** • 💴 Yen: **${profile.yen.toLocaleString()}**`
  ).setColor(0x22c55e);
}

function travelRows(profile, userId) {
  const unlocked = core.unlockedAreas(profile);
  const rows = [];
  for (let i = 0; i < unlocked.length; i += 4) {
    rows.push(new ActionRowBuilder().addComponents(
      ...unlocked.slice(i, i + 4).map(area => new ButtonBuilder()
        .setCustomId(`cr_area_${area.id}_${userId}`)
        .setLabel(area.name.slice(0, 25))
        .setStyle(area.id === profile.areaId ? ButtonStyle.Success : ButtonStyle.Secondary))
    ));
  }
  return rows.slice(0, 5);
}

function inventoryRows(profile, userId) {
  const items = profile.inventory.slice(0, 8);
  const rows = [];
  for (let i = 0; i < items.length; i += 4) {
    rows.push(new ActionRowBuilder().addComponents(
      ...items.slice(i, i + 4).map(id => {
        const tool = core.TOOLS.find(t => t.id === id);
        return new ButtonBuilder().setCustomId(`cr_equip_${id}_${userId}`).setLabel(tool?.name || id).setStyle(profile.equippedToolId === id ? ButtonStyle.Success : ButtonStyle.Secondary);
      })
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Primary)));
  return rows.slice(0, 5);
}

function activeRaid(guildId) {
  const g = guildData(guildId);
  if (g.raid && (g.raid.expiresAt <= Date.now() || g.raid.hp <= 0)) {
    if (g.raid.hp > 0 && g.raid.expiresAt <= Date.now()) g.raid = null;
    save();
  }
  return g.raid;
}

function ensureRaid(guildId, starterProfile) {
  const g = guildData(guildId);
  let raid = activeRaid(guildId);
  if (raid) return raid;
  const scale = Math.max(1, Math.floor(starterProfile.level / 250));
  const maxHp = 220000 * scale;
  raid = g.raid = {
    id: crypto.randomBytes(3).toString('hex'),
    name: 'King of Curses Echo',
    hp: maxHp,
    maxHp,
    level: Math.max(350, starterProfile.level + 100),
    createdAt: Date.now(),
    expiresAt: Date.now() + 15 * 60 * 1000,
    contributions: {},
    lastAttack: {}
  };
  save();
  return raid;
}

function raidEmbed(raid) {
  const mins = Math.max(0, Math.ceil((raid.expiresAt - Date.now()) / 60000));
  return new EmbedBuilder().setTitle('🚨 SERVER RAID • KING OF CURSES ECHO').setDescription(
    `**${gameAura('raid')}**\n\n` +
    `❤️ ${bar(raid.hp, raid.maxHp, 16)}\n**${Math.max(0, raid.hp).toLocaleString()} / ${raid.maxHp.toLocaleString()} HP**\n` +
    `⏱️ **${mins} min remaining**\n\nAttack cooldown: **5 seconds per player**. Everyone contributes to the same boss.`
  ).setColor(0xdc2626);
}

async function handleRaidAttack(interaction, userId) {
  if (!verifyOwner(interaction, userId)) return true;
  const g = guildData(interaction.guild.id);
  const raid = activeRaid(interaction.guild.id);
  if (!raid) return interaction.reply({ content: 'That raid ended. Open the Raid panel to spawn the next one.', ephemeral: true });
  const last = raid.lastAttack[userId] || 0;
  if (Date.now() - last < 5000) return interaction.reply({ content: `⏱️ Raid attack cooldown: **${Math.ceil((5000 - (Date.now() - last)) / 1000)}s**`, ephemeral: true });

  const profile = getProfile(interaction.guild.id, userId);
  const dmg = Math.floor(core.combatPower(profile) * (1.8 + Math.random() * 1.2));
  raid.lastAttack[userId] = Date.now();
  raid.hp -= dmg;
  raid.contributions[userId] = (raid.contributions[userId] || 0) + dmg;
  profile.stats.raidDamage += dmg;
  profile.mastery += 1;

  if (raid.hp <= 0) {
    raid.hp = 0;
    const contributors = Object.entries(raid.contributions);
    for (const [id, contribution] of contributors) {
      const p = getProfile(interaction.guild.id, id);
      const share = contribution / Math.max(1, raid.maxHp);
      core.addRewards(p, Math.floor(50000 + 90000 * share), Math.floor(60000 + 120000 * share));
      p.domainFragments += contribution >= raid.maxHp * 0.08 ? 2 : 1;
    }
    g.raid = null;
    save();
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('👑 SERVER RAID CLEARED').setDescription(`**The King of Curses Echo was exorcised.**\n\nYour hit: **${dmg.toLocaleString()}** damage\nRewards were distributed to **${contributors.length} sorcerer(s)** based on contribution.\n🌀 Everyone received Domain Fragments.`).setColor(0xfacc15)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Primary))]
    });
  }

  save();
  return interaction.update({
    embeds: [raidEmbed(raid).addFields({ name: 'Your hit', value: `**${dmg.toLocaleString()} damage**`, inline: true }, { name: 'Your contribution', value: `**${raid.contributions[userId].toLocaleString()}**`, inline: true })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_raidattack_${userId}`).setLabel('Attack Raid').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
    )]
  });
}

async function handleGameButton(interaction) {
  if (!interaction.customId.startsWith('cr_')) return false;
  const parts = interaction.customId.split('_');
  const action = parts[1];

  if (['m1','ct','block','dodge','black','domain','run'].includes(action)) {
    return combatAction(interaction, action, parts[2]);
  }

  if (action === 'raidattack') return handleRaidAttack(interaction, parts[2]);

  if (action === 'area') {
    const userId = parts[parts.length - 1];
    const areaId = parts.slice(2, -1).join('_');
    if (!verifyOwner(interaction, userId)) return true;
    const p = getProfile(interaction.guild.id, userId);
    const area = core.AREAS.find(a => a.id === areaId);
    if (!area || p.level < area.minLevel) return interaction.reply({ content: '🔒 Area locked.', ephemeral: true });
    p.areaId = area.id;
    p.activeQuest = null;
    save();
    await interaction.update({ embeds: [mainEmbed(p, interaction.user.username).setDescription(`🗺️ **Traveled to ${area.name}.**\n\n${mainEmbed(p, interaction.user.username).data.description}`)], components: mainRows(userId) });
    return true;
  }

  if (action === 'equip') {
    const userId = parts[parts.length - 1];
    const toolId = parts.slice(2, -1).join('_');
    if (!verifyOwner(interaction, userId)) return true;
    const p = getProfile(interaction.guild.id, userId);
    if (!p.inventory.includes(toolId)) return interaction.reply({ content: 'You do not own that tool.', ephemeral: true });
    p.equippedToolId = toolId;
    save();
    await interaction.update({ embeds: [inventoryEmbed(p)], components: inventoryRows(p, userId) });
    return true;
  }

  const userId = parts[2];
  if (!verifyOwner(interaction, userId)) return true;
  const p = getProfile(interaction.guild.id, userId);

  if (action === 'home') {
    await interaction.update({ embeds: [mainEmbed(p, interaction.user.username)], components: mainRows(userId) });
  } else if (action === 'fight') {
    await startCombat(interaction, false);
  } else if (action === 'boss') {
    await startCombat(interaction, true);
  } else if (action === 'quest') {
    if (!p.activeQuest) core.startQuest(p);
    save();
    await interaction.update({ embeds: [questEmbed(p)], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_fight_${userId}`).setLabel('Hunt Quest Target').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
    )] });
  } else if (action === 'roll') {
    const result = core.rollTechnique(p);
    save();
    if (!result.ok) {
      await interaction.reply({ content: `💴 You need **${result.cost.toLocaleString()} Yen** for a Technique Roll.`, ephemeral: true });
    } else {
      await interaction.update({ embeds: [new EmbedBuilder().setTitle(`${rarityEmoji(result.technique.rarity)} ${result.technique.rarity.toUpperCase()} TECHNIQUE`).setDescription(`**${gameAura('roll')}**\n\nYou rolled **${result.technique.name}**!\nMain Move: **${result.technique.move}**\nDomain: **${result.technique.domain || 'None'}**\n\nMastery reset to **${p.mastery}** after changing technique.\nMythic pity: **${p.techniquePity}/40**`).setColor(result.technique.rarity === 'Mythic' ? 0xe879f9 : 0x5865f2)], components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cr_roll_${userId}`).setLabel('Roll Again • 7,500 Yen').setEmoji('🎲').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
      )] });
    }
  } else if (action === 'tech') {
    await interaction.update({ embeds: [techniqueEmbed(p)], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_roll_${userId}`).setLabel('Technique Roll').setEmoji('🎲').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
    )] });
  } else if (action === 'inventory') {
    await interaction.update({ embeds: [inventoryEmbed(p)], components: inventoryRows(p, userId) });
  } else if (action === 'stats') {
    await interaction.update({ embeds: [statsEmbed(p)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Primary))] });
  } else if (action === 'travel') {
    await interaction.update({ embeds: [new EmbedBuilder().setTitle('🗺️ TRAVEL').setDescription(core.AREAS.map(a => `${p.level >= a.minLevel ? '✅' : '🔒'} **${a.name}** • Lv.${a.minLevel}+`).join('\n')).setColor(0x14b8a6)], components: travelRows(p, userId) });
  } else if (action === 'heal') {
    p.hp = p.maxHp;
    p.cursedEnergy = p.maxCursedEnergy;
    save();
    await interaction.update({ embeds: [mainEmbed(p, interaction.user.username).setDescription(`💚 **Recovered HP + cursed energy.**\n\n${mainEmbed(p, interaction.user.username).data.description}`)], components: mainRows(userId) });
  } else if (action === 'raid') {
    const raid = ensureRaid(interaction.guild.id, p);
    await interaction.update({ embeds: [raidEmbed(raid)], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cr_raidattack_${userId}`).setLabel('Attack Raid').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cr_home_${userId}`).setLabel('Main Panel').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
    )] });
  }
  return true;
}

function duelId() {
  return crypto.randomBytes(3).toString('hex');
}

async function challengeDuel(interaction, opponent) {
  if (!interaction.guild) return interaction.reply({ content: 'Duels only work in servers.', ephemeral: true });
  if (opponent.bot || opponent.id === interaction.user.id) return interaction.reply({ content: 'Choose another human player.', ephemeral: true });
  const id = duelId();
  const duel = {
    id,
    guildId: interaction.guild.id,
    a: interaction.user.id,
    b: opponent.id,
    hp: { [interaction.user.id]: 1000, [opponent.id]: 1000 },
    choices: {},
    round: 1,
    status: 'pending',
    messageId: null
  };
  duels.set(id, duel);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`crduel_accept_${id}`).setLabel('Accept Duel').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`crduel_decline_${id}`).setLabel('Decline').setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({
    content: `<@${opponent.id}> — <@${interaction.user.id}> challenged you to a **Cursed Duel**.`,
    embeds: [new EmbedBuilder().setTitle('⚔️ CURSED DUEL CHALLENGE').setDescription('First sorcerer to break the opponent wins. Each round choose **Strike**, **Guard**, or **Technique**.').setColor(0xef4444)],
    components: [row],
    allowedMentions: { users: [opponent.id, interaction.user.id] }
  });
}

function duelRows(id) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`crduel_strike_${id}`).setLabel('Strike').setEmoji('👊').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`crduel_guard_${id}`).setLabel('Guard').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`crduel_technique_${id}`).setLabel('Technique').setEmoji('🧬').setStyle(ButtonStyle.Danger)
  )];
}

function resolveDuelRound(duel) {
  const ids = [duel.a, duel.b];
  const pA = getProfile(duel.guildId, duel.a);
  const pB = getProfile(duel.guildId, duel.b);
  const choices = duel.choices;
  const log = [];
  for (const attacker of ids) {
    const defender = attacker === duel.a ? duel.b : duel.a;
    const profile = attacker === duel.a ? pA : pB;
    const action = choices[attacker];
    const defend = choices[defender];
    let damage = action === 'technique' ? 180 + Math.floor(core.combatPower(profile) * 0.20) : 110 + Math.floor(core.combatPower(profile) * 0.12);
    if (defend === 'guard') damage = Math.floor(damage * 0.38);
    if (defend === 'technique' && action === 'strike') damage = Math.floor(damage * 1.15);
    duel.hp[defender] -= damage;
    log.push(`<@${attacker}> used **${action}** → **${damage} dmg**`);
  }
  duel.choices = {};
  duel.round += 1;
  return log;
}

async function handleDuelButton(interaction) {
  if (!interaction.customId.startsWith('crduel_')) return false;
  const [, action, id] = interaction.customId.split('_');
  const duel = duels.get(id);
  if (!duel || duel.guildId !== interaction.guild?.id) {
    await interaction.reply({ content: 'This duel expired.', ephemeral: true });
    return true;
  }
  if (![duel.a, duel.b].includes(interaction.user.id)) {
    await interaction.reply({ content: 'You are not part of this duel.', ephemeral: true });
    return true;
  }
  if (action === 'decline') {
    if (interaction.user.id !== duel.b) return interaction.reply({ content: 'Only the challenged player can decline.', ephemeral: true });
    duels.delete(id);
    await interaction.update({ content: '⚔️ Duel declined.', embeds: [], components: [] });
    return true;
  }
  if (action === 'accept') {
    if (interaction.user.id !== duel.b) return interaction.reply({ content: 'Only the challenged player can accept.', ephemeral: true });
    duel.status = 'active';
    await interaction.update({
      content: `<@${duel.a}> vs <@${duel.b}>`,
      embeds: [new EmbedBuilder().setTitle('⚔️ CURSED DUEL • ROUND 1').setDescription(`<@${duel.a}> ❤️ 1000\n<@${duel.b}> ❤️ 1000\n\nBoth players choose an action.`).setColor(0xef4444)],
      components: duelRows(id),
      allowedMentions: { parse: [] }
    });
    return true;
  }
  if (duel.status !== 'active') return interaction.reply({ content: 'Duel has not started.', ephemeral: true });
  if (duel.choices[interaction.user.id]) return interaction.reply({ content: 'You already chose this round.', ephemeral: true });
  duel.choices[interaction.user.id] = action;
  await interaction.reply({ content: `✅ Locked in: **${action}**.`, ephemeral: true });
  if (!duel.choices[duel.a] || !duel.choices[duel.b]) return true;

  const log = resolveDuelRound(duel);
  const dead = [duel.a, duel.b].find(uid => duel.hp[uid] <= 0);
  if (dead || duel.round > 8) {
    const winner = dead ? (dead === duel.a ? duel.b : duel.a) : (duel.hp[duel.a] >= duel.hp[duel.b] ? duel.a : duel.b);
    const loser = winner === duel.a ? duel.b : duel.a;
    const wp = getProfile(duel.guildId, winner);
    const lp = getProfile(duel.guildId, loser);
    wp.stats.wins += 1; lp.stats.losses += 1;
    core.addRewards(wp, 450 + Math.floor(lp.level * 5), 900 + Math.floor(lp.level * 8));
    save();
    duels.delete(id);
    await interaction.message.edit({
      embeds: [new EmbedBuilder().setTitle('👑 CURSED DUEL FINISHED').setDescription(`${log.join('\n')}\n\n🏆 <@${winner}> wins!\n+XP +Yen awarded.`).setColor(0xfacc15)],
      components: [],
      allowedMentions: { parse: [] }
    }).catch(() => {});
    return true;
  }

  await interaction.message.edit({
    embeds: [new EmbedBuilder().setTitle(`⚔️ CURSED DUEL • ROUND ${duel.round}`).setDescription(`${log.join('\n')}\n\n<@${duel.a}> ❤️ **${Math.max(0, duel.hp[duel.a])}**\n<@${duel.b}> ❤️ **${Math.max(0, duel.hp[duel.b])}**\n\nChoose again.`).setColor(0xef4444)],
    components: duelRows(id),
    allowedMentions: { parse: [] }
  }).catch(() => {});
  return true;
}

module.exports = {
  openMain,
  handleGameButton,
  challengeDuel,
  handleDuelButton,
  getProfile
};
