const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');
const { loadJson, saveJson } = require('../security/jsonStore');

const FILE = path.join(__dirname, '..', '..', 'data', 'serverBosses.json');
const store = loadJson(FILE, { guilds: {} });
const refreshAt = new Map();

const BOSSES = [
  { name: 'The Domain Eater', emoji: '🌀', line: 'The barrier is cracking. Six Eyes says the whole server has to move.' },
  { name: 'Special Grade: Hollow Warden', emoji: '👁️', line: 'It is feeding on inactivity. Annoying. Fix that.' },
  { name: 'The Cursed Monarch', emoji: '👹', line: 'A Special Grade curse has claimed the server as its hunting ground.' },
  { name: 'Shibuya Night Terror', emoji: '🌑', line: 'The lights are out. The Domain is not.' },
  { name: 'The Barrier Breaker', emoji: '💥', line: 'It wants the server divided. Beat it by doing the opposite.' }
];

function save() {
  saveJson(FILE, store);
}

function guildState(guildId) {
  store.guilds[guildId] ||= {
    active: null,
    lastResult: null,
    curseUntil: 0,
    blessingUntil: 0,
    nextDifficulty: 1,
    nextSpawnAt: 0,
    rewardRoleId: null,
    rewardRoleOwned: false,
    rewardedUserIds: [],
    rewardRoleExpiresAt: 0
  };
  return store.guilds[guildId];
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function bar(value, target, length = 10) {
  const ratio = target <= 0 ? 1 : clamp(value / target, 0, 1);
  const filled = Math.round(ratio * length);
  return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

function activeBoss(guildId) {
  return guildState(guildId).active;
}

function validActive(event) {
  return event && event.status === 'active';
}

function taskProgress(event, task) {
  switch (task.type) {
    case 'messages': return event.metrics.validMessages || 0;
    case 'voice_minutes': return Math.floor(event.metrics.voiceMinutes || 0);
    case 'active_channels': {
      return Object.values(event.metrics.channelMessages || {}).filter(v => v >= 3).length;
    }
    case 'replies': return event.metrics.replies || 0;
    case 'participants': return (event.metrics.participants || []).length;
    case 'contributors': {
      return Object.values(event.metrics.userMessages || {}).filter(v => v >= 3).length;
    }
    default: return 0;
  }
}

function taskText(event, task) {
  const progress = taskProgress(event, task);
  const done = progress >= task.target;
  const icon = done ? '✅' : task.icon;
  return `${icon} **${task.name}**\n${bar(progress, task.target)}  **${progress}/${task.target} ${task.unit}**\n${task.description}`;
}

function bossHp(event) {
  if (!event?.tasks?.length) return 100;
  const avg = event.tasks.reduce((sum, task) => {
    return sum + clamp(taskProgress(event, task) / task.target, 0, 1);
  }, 0) / event.tasks.length;
  return clamp(Math.round(100 - avg * 100), 0, 100);
}

function allTasksComplete(event) {
  return event.tasks.every(task => taskProgress(event, task) >= task.target);
}

function participantCount(event) {
  return (event.metrics.participants || []).length;
}

function chooseTasks(guild, factor) {
  const cachedHumans = guild.members.cache.filter(m => !m.user.bot).size;
  const humans = Math.max(5, cachedHumans || Math.max(5, guild.memberCount - 2));
  const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).size;
  const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice).size;

  const pool = [
    {
      type: 'messages', icon: '📨', name: 'Break the Silence', unit: 'messages',
      target: Math.ceil(clamp(humans * 5, 40, 320) * factor),
      description: 'Send normal human messages. Spam, bot-command grinding and duplicates do not count.'
    },
    {
      type: 'participants', icon: '👥', name: 'Sorcerer Mobilization', unit: 'members',
      target: Math.ceil(clamp(humans * 0.28, 4, 22) * factor),
      description: 'Get different server members to participate in text or voice.'
    },
    {
      type: 'replies', icon: '🤝', name: 'Binding Vows', unit: 'replies',
      target: Math.ceil(clamp(humans * 1.2, 12, 90) * factor),
      description: 'Reply to real people and keep conversations going.'
    },
    {
      type: 'contributors', icon: '⚡', name: 'Cursed Energy Network', unit: 'contributors',
      target: Math.ceil(clamp(humans * 0.22, 4, 16) * factor),
      description: 'Different members must each contribute at least 3 valid messages.'
    }
  ];

  if (textChannels >= 2) {
    pool.push({
      type: 'active_channels', icon: '🗺️', name: 'Spread the Barrier', unit: 'channels',
      target: Math.ceil(clamp(textChannels * 0.35, 2, 7) * factor),
      description: 'Activate different text channels with at least 3 valid human messages each.'
    });
  }

  if (voiceChannels >= 1) {
    pool.push({
      type: 'voice_minutes', icon: '🎙️', name: 'Hold the Domain', unit: 'voice min',
      target: Math.ceil(clamp(humans * 4, 30, 260) * factor),
      description: 'Accumulate combined human voice minutes outside the AFK channel.'
    });
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = [];
  for (const task of shuffled) {
    if (picked.length >= 3) break;
    if (picked.some(x => x.type === task.type)) continue;
    picked.push(task);
  }
  return picked;
}

function bossEmbed(guild, event) {
  const state = guildState(guild.id);
  const hp = bossHp(event);
  const deadline = Math.floor(event.endsAt / 1000);
  const statusLine = event.status === 'active'
    ? `⏳ Ends <t:${deadline}:R> • <t:${deadline}:f>`
    : event.status === 'defeated'
      ? '✅ **BOSS DEFEATED**'
      : event.status === 'failed'
        ? '☠️ **THE SERVER WAS CURSED**'
        : '⚪ Event closed';

  const curse = state.curseUntil > Date.now()
    ? `\n☠️ **Server Curse active until <t:${Math.floor(state.curseUntil / 1000)}:R>**`
    : state.blessingUntil > Date.now()
      ? `\n✨ **Server Blessing active until <t:${Math.floor(state.blessingUntil / 1000)}:R>**`
      : '';

  return new EmbedBuilder()
    .setTitle(`${event.boss.emoji} SPECIAL GRADE SERVER BOSS • ${event.boss.name}`)
    .setDescription(
      `**${event.boss.line}**\n\n` +
      `This is a **server-wide Discord event**, not Cursed Realms. Everyone contributes through normal server activity.\n\n` +
      `❤️ **Boss HP:** ${bar(100 - hp, 100)}  **${hp}%**\n` +
      `${statusLine}${curse}`
    )
    .addFields(event.tasks.map(task => ({ name: '\u200b', value: taskText(event, task), inline: false })))
    .addFields({
      name: '👁️ Six Eyes Report',
      value:
        `Participants: **${participantCount(event)}**\n` +
        `Difficulty: **${event.difficulty.toUpperCase()}**\n` +
        `Failure curse: **6h boss lockout + next boss 15% harder**\n` +
        `Success: **Boss Slayer role + next boss 10% easier**`,
      inline: false
    })
    .setColor(event.status === 'failed' ? 0xff3b30 : event.status === 'defeated' ? 0x57f287 : 0x7dd3fc)
    .setFooter({ text: `Infinity Server Boss • ${event.id}` })
    .setTimestamp();
}

function bossButtons(event) {
  const disabled = event.status !== 'active';
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`serverboss_refresh_${event.id}`)
      .setLabel('Refresh')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`serverboss_rules_${event.id}`)
      .setLabel('How it works')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`serverboss_participate_${event.id}`)
      .setLabel('Join the fight')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  )];
}

async function refreshBossPanel(guild, force = false) {
  const event = activeBoss(guild.id);
  if (!event) return false;

  const key = guild.id;
  const now = Date.now();
  if (!force && now - (refreshAt.get(key) || 0) < 15000) return false;
  refreshAt.set(key, now);

  const channel = guild.channels.cache.get(event.channelId);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(event.messageId).catch(() => null);
  if (!message) return false;

  await message.edit({ embeds: [bossEmbed(guild, event)], components: bossButtons(event) }).catch(() => {});
  return true;
}

function markParticipant(event, userId) {
  event.metrics.participants ||= [];
  if (!event.metrics.participants.includes(userId)) event.metrics.participants.push(userId);
}

function meaningfulContent(content = '') {
  const normalized = String(content)
    .replace(/<@!?\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return normalized;
}

async function recordBossMessage(message, context = {}) {
  const event = activeBoss(message.guild.id);
  if (!validActive(event)) return false;
  if (Date.now() >= event.endsAt) return false;
  if (context.isBotInteraction) return false;
  if (['trap', 'logs', 'mediation', 'bot_interaction'].includes(context.policyType)) return false;

  const content = meaningfulContent(message.content);
  if (content.length < 3 && !message.reference?.messageId) return false;

  event.metrics.lastMessageAt ||= {};
  event.metrics.lastContent ||= {};
  event.metrics.userMessages ||= {};
  event.metrics.channelMessages ||= {};

  const now = Date.now();
  const userId = message.author.id;
  const lastAt = event.metrics.lastMessageAt[userId] || 0;
  const lastContent = event.metrics.lastContent[userId] || '';

  // One contribution every 8 seconds per user; duplicate spam does not farm progress.
  if (now - lastAt < 8000) return false;
  if (content && content === lastContent) return false;

  event.metrics.lastMessageAt[userId] = now;
  event.metrics.lastContent[userId] = content;
  event.metrics.validMessages = (event.metrics.validMessages || 0) + 1;
  event.metrics.userMessages[userId] = (event.metrics.userMessages[userId] || 0) + 1;
  event.metrics.channelMessages[message.channel.id] = (event.metrics.channelMessages[message.channel.id] || 0) + 1;
  if (message.reference?.messageId) event.metrics.replies = (event.metrics.replies || 0) + 1;
  markParticipant(event, userId);

  save();
  await checkResolution(message.guild);
  await refreshBossPanel(message.guild);
  return true;
}

function difficultyFactor(state, difficulty) {
  const base = difficulty === 'nightmare' ? 1.55 : difficulty === 'hard' ? 1.25 : 1;
  return base * clamp(Number(state.nextDifficulty || 1), 0.75, 1.75);
}

function generateId() {
  return `BOSS-${Date.now().toString(36).toUpperCase()}`;
}

async function spawnBoss(guild, channel, difficulty = 'normal') {
  const state = guildState(guild.id);
  const now = Date.now();
  if (validActive(state.active)) return { ok: false, reason: 'active', event: state.active };
  if (state.nextSpawnAt && state.nextSpawnAt > now) return { ok: false, reason: 'cooldown', until: state.nextSpawnAt };
  if (!channel?.isTextBased()) return { ok: false, reason: 'channel' };

  const factor = difficultyFactor(state, difficulty);
  const boss = BOSSES[Math.floor(Math.random() * BOSSES.length)];
  const event = {
    id: generateId(),
    status: 'active',
    boss,
    difficulty,
    spawnedAt: now,
    endsAt: now + 24 * 60 * 60 * 1000,
    channelId: channel.id,
    messageId: null,
    tasks: chooseTasks(guild, factor),
    metrics: {
      validMessages: 0,
      replies: 0,
      voiceMinutes: 0,
      participants: [],
      voiceUsers: [],
      userMessages: {},
      channelMessages: {},
      lastMessageAt: {},
      lastContent: {},
      lastVoiceTickAt: now
    }
  };

  state.active = event;
  state.nextDifficulty = 1;
  save();

  const sent = await channel.send({
    content: '@everyone **A Special Grade server boss has appeared. You have 24 hours.**',
    embeds: [bossEmbed(guild, event)],
    components: bossButtons(event),
    allowedMentions: { parse: ['everyone'] }
  }).catch(() => null);

  if (!sent) {
    state.active = null;
    save();
    return { ok: false, reason: 'send' };
  }

  event.messageId = sent.id;
  save();
  return { ok: true, event };
}

async function giveBossSlayerRole(guild, event) {
  let role = guild.roles.cache.find(r => r.name === '✨ Infinity Boss Slayer');
  let owned = false;
  if (!role) {
    role = await guild.roles.create({
      name: '✨ Infinity Boss Slayer',
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: `Infinity Server Boss ${event.id} reward`
    }).catch(() => null);
    owned = Boolean(role);
  }
  if (!role) return null;

  const rewarded = [];
  for (const userId of event.metrics.participants || []) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const added = await member.roles.add(role, `Defeated Infinity server boss ${event.id}`)
      .then(() => true)
      .catch(() => false);
    if (added) rewarded.push(userId);
  }

  const state = guildState(guild.id);
  state.rewardRoleId = role.id;
  state.rewardRoleOwned = owned;
  state.rewardedUserIds = rewarded;
  state.rewardRoleExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  save();
  return role;
}

async function resolveSuccess(guild, event) {
  if (event.status !== 'active') return;
  event.status = 'defeated';
  event.resolvedAt = Date.now();
  const state = guildState(guild.id);
  state.lastResult = { status: 'defeated', boss: event.boss.name, at: event.resolvedAt, id: event.id };
  state.blessingUntil = Date.now() + 6 * 60 * 60 * 1000;
  state.curseUntil = 0;
  state.nextDifficulty = 0.9;
  state.nextSpawnAt = Date.now() + 60 * 60 * 1000;
  save();

  const role = await giveBossSlayerRole(guild, event);
  const channel = guild.channels.cache.get(event.channelId);
  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('✨ DOMAIN SECURED • SERVER BOSS DEFEATED')
        .setDescription(
          `**${event.boss.name} has been erased.**\n\n` +
          `👁️ Six Eyes report: all three objectives were completed before the deadline.\n` +
          `✨ Server Blessing: **next boss is 10% easier**\n` +
          `${role ? '🏆 Participants received **✨ Boss Slayer** for 24 hours.' : '🏆 Boss Slayer role reward could not be created.'}`
        )
        .setColor(0x57f287)
        .setFooter({ text: `Infinity Server Boss • ${event.id}` })]
    }).catch(() => {});
  }
  await refreshBossPanel(guild, true);
}

async function resolveFailure(guild, event) {
  if (event.status !== 'active') return;
  event.status = 'failed';
  event.resolvedAt = Date.now();
  const state = guildState(guild.id);
  state.lastResult = { status: 'failed', boss: event.boss.name, at: event.resolvedAt, id: event.id };
  state.curseUntil = Date.now() + 6 * 60 * 60 * 1000;
  state.blessingUntil = 0;
  state.nextDifficulty = 1.15;
  state.nextSpawnAt = Date.now() + 6 * 60 * 60 * 1000;
  save();

  const channel = guild.channels.cache.get(event.channelId);
  if (channel?.isTextBased()) {
    await channel.send({
      content: '@everyone',
      embeds: [new EmbedBuilder()
        .setTitle('☠️ THE BOSS SURVIVED • SERVER CURSE ACTIVE')
        .setDescription(
          `**${event.boss.name} survived the full 24 hours.**\n\n` +
          `☠️ Infinity marks the server as **CURSED for 6 hours**.\n` +
          `⛓️ You cannot start another boss during that curse.\n` +
          `📈 The next boss is **15% harder**.\n\n` +
          `Nothing destructive happens to channels, roles or members — the punishment stays inside the Boss Event system.`
        )
        .setColor(0xff3b30)
        .setFooter({ text: `Infinity Server Boss • ${event.id}` })],
      allowedMentions: { parse: ['everyone'] }
    }).catch(() => {});
  }
  await refreshBossPanel(guild, true);
}

async function checkResolution(guild) {
  const event = activeBoss(guild.id);
  if (!validActive(event)) return false;
  if (allTasksComplete(event)) {
    await resolveSuccess(guild, event);
    return true;
  }
  if (Date.now() >= event.endsAt) {
    await resolveFailure(guild, event);
    return true;
  }
  return false;
}

async function tickGuildBoss(guild) {
  const state = guildState(guild.id);
  const event = state.active;
  const now = Date.now();

  if (validActive(event)) {
    // Voice progress is measured as combined human person-minutes.
    const last = event.metrics.lastVoiceTickAt || now;
    const deltaMinutes = clamp((now - last) / 60000, 0, 2);
    event.metrics.lastVoiceTickAt = now;

    if (deltaMinutes > 0.15) {
      for (const channel of guild.channels.cache.values()) {
        if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) continue;
        if (guild.afkChannelId && channel.id === guild.afkChannelId) continue;
        for (const member of channel.members.values()) {
          if (member.user.bot) continue;
          event.metrics.voiceMinutes = (event.metrics.voiceMinutes || 0) + deltaMinutes;
          event.metrics.voiceUsers ||= [];
          if (!event.metrics.voiceUsers.includes(member.id)) event.metrics.voiceUsers.push(member.id);
          markParticipant(event, member.id);
        }
      }
      save();
    }

    await checkResolution(guild);
    await refreshBossPanel(guild, true);
  }

  // Remove cosmetic Boss Slayer reward after 24h.
  if (state.rewardRoleId && state.rewardRoleExpiresAt && state.rewardRoleExpiresAt <= now) {
    const role = guild.roles.cache.get(state.rewardRoleId);
    if (role) {
      for (const userId of state.rewardedUserIds || []) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.remove(role, 'Infinity Boss Slayer reward expired').catch(() => {});
      }
      if (state.rewardRoleOwned) {
        await role.delete('Infinity Boss Slayer reward expired').catch(() => {});
      }
    }
    state.rewardRoleId = null;
    state.rewardRoleOwned = false;
    state.rewardedUserIds = [];
    state.rewardRoleExpiresAt = 0;
    save();
  }
}

async function tickAllBosses(client) {
  for (const guild of client.guilds.cache.values()) {
    await tickGuildBoss(guild).catch(error => {
      console.error(`[ServerBoss] tick failed for ${guild.id}:`, error?.message || error);
    });
  }
}

async function cancelBoss(guild, actorId) {
  const state = guildState(guild.id);
  const event = state.active;
  if (!validActive(event)) return false;
  event.status = 'cancelled';
  event.cancelledAt = Date.now();
  event.cancelledBy = actorId;
  state.nextSpawnAt = Date.now() + 5 * 60 * 1000;
  save();
  await refreshBossPanel(guild, true);
  return true;
}

async function handleBossCommand(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;

  const action = interaction.options.getString('action') || 'auto';
  const difficulty = interaction.options.getString('difficulty') || 'normal';
  const hasAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
  const state = guildState(guild.id);
  const event = state.active;

  if (action === 'status' || (action === 'auto' && validActive(event))) {
    if (!event) {
      return interaction.reply({ content: '👁️ No server boss is active right now.', ephemeral: true });
    }
    return interaction.reply({ embeds: [bossEmbed(guild, event)], components: bossButtons(event), ephemeral: false });
  }

  if (action === 'cancel') {
    if (!hasAdmin) return interaction.reply({ content: '❌ Only an Administrator can cancel the server boss.', ephemeral: true });
    const ok = await cancelBoss(guild, interaction.user.id);
    return interaction.reply({ content: ok ? '🛑 Server boss event cancelled. No failure curse was applied.' : 'No active boss to cancel.', ephemeral: true });
  }

  if (action === 'spawn' || action === 'auto') {
    if (!hasAdmin) {
      return interaction.reply({
        content: validActive(event) ? 'Use `/boss action:status` to view the active boss.' : '👁️ No boss is active. An Administrator can spawn one with `/boss action:spawn`.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await spawnBoss(guild, interaction.channel, difficulty);
    if (!result.ok) {
      if (result.reason === 'active') return interaction.editReply('👹 A server boss is already active.');
      if (result.reason === 'cooldown') return interaction.editReply(`☠️ The server is still under the boss cooldown. Try again <t:${Math.floor(result.until / 1000)}:R>.`);
      return interaction.editReply('❌ Infinity could not spawn the server boss in this channel.');
    }
    return interaction.editReply(`👹 **${result.event.boss.name} spawned.** The server has **24 hours** and **3 shared objectives**.`);
  }

  return false;
}

async function handleBossButton(interaction) {
  if (!interaction.guild || !interaction.isButton()) return false;
  if (!interaction.customId.startsWith('serverboss_')) return false;
  const event = activeBoss(interaction.guild.id);
  if (!event) {
    await interaction.reply({ content: 'This server boss event no longer exists.', ephemeral: true }).catch(() => {});
    return true;
  }
  const parts = interaction.customId.split('_');
  const action = parts[1];
  const id = parts.slice(2).join('_');
  if (id !== event.id) {
    await interaction.reply({ content: 'That boss panel is outdated.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (action === 'refresh') {
    await refreshBossPanel(interaction.guild, true);
    await interaction.reply({ content: '👁️ Six Eyes refreshed the boss progress.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (action === 'rules') {
    await interaction.reply({
      content:
        '**Server Boss Rules**\n' +
        '• 24 hours to complete all 3 objectives.\n' +
        '• Normal Discord activity counts; Cursed Realms progress does not.\n' +
        '• Bot/minigame command spam, duplicate spam, trap channels and bot-logs do not count.\n' +
        '• Success gives a temporary Boss Slayer role and makes the next boss easier.\n' +
        '• Failure causes a 6h Boss Curse and the next boss becomes 15% harder.',
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  if (action === 'participate') {
    await interaction.reply({
      content: '⚔️ **You are in.** Just use the Discord normally: valid chat messages, real replies and voice activity contribute automatically. Bot-command spam and duplicate spam do not count.',
      ephemeral: true
    }).catch(() => {});
    return true;
  }

  return false;
}

function debugState(guildId) {
  return guildState(guildId);
}

module.exports = {
  activeBoss,
  bossEmbed,
  spawnBoss,
  cancelBoss,
  handleBossCommand,
  handleBossButton,
  recordBossMessage,
  tickAllBosses,
  tickGuildBoss,
  checkResolution,
  debugState,
  taskProgress
};
