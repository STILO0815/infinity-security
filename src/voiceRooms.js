const path = require("path");
const { loadJson, saveJson } = require("./jsonStore");
const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const DATA_FILE = path.join(__dirname, "..", "..", "data", "voiceRooms.json");

let state = loadJson(DATA_FILE, { guilds: {} });
const deleteTimers = new Map();
const raidJoinTracker = new Map();

function save() { saveJson(DATA_FILE, state); }

function guildState(guildId) {
  state.guilds[guildId] ||= {
    rooms: {},
    stats: {},
    activeSessions: {},
    raidLocks: {},
    parties: {}
  };
  state.guilds[guildId].rooms ||= {};
  state.guilds[guildId].stats ||= {};
  state.guilds[guildId].activeSessions ||= {};
  state.guilds[guildId].raidLocks ||= {};
  state.guilds[guildId].parties ||= {};
  for (const room of Object.values(state.guilds[guildId].rooms)) {
    room.coOwners ||= [];
    room.blocklist ||= [];
    room.queue ||= [];
    room.pendingKnocks ||= {};
    room.knockHistory ||= {};
    room.preset ||= "gaming";
    room.autoPrivate ??= false;
    room.panic ??= false;
    room.type ||= "personal";
    room.aloneSince ??= null;
    room.afkWarned ??= false;
    room.panelMessageId ??= null;
  }
  return state.guilds[guildId];
}

function sanitizeName(value) {
  return String(value || "User")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[<>@#:`]/g, "")
    .trim()
    .slice(0, 24) || "User";
}

function buildRoomName(cfg, member) {
  const name = sanitizeName(member.displayName || member.user.username);
  return String(cfg.voiceDomain.roomNameTemplate || "👁️ {name}'s Domain")
    .replace("{name}", name)
    .slice(0, 100);
}

function roomControls(channelId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vroom_lock_${channelId}`)
        .setLabel("Lock / Unlock")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`vroom_hide_${channelId}`)
        .setLabel("Hide / Show")
        .setEmoji("👁️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`vroom_panic_${channelId}`)
        .setLabel("Panic")
        .setEmoji("🌀")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`vroom_limit5_${channelId}`)
        .setLabel("Limit 5")
        .setEmoji("5️⃣")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`vroom_unlimited_${channelId}`)
        .setLabel("Unlimited")
        .setEmoji("♾️")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function getRoom(guildId, channelId) {
  return guildState(guildId).rooms[channelId] || null;
}

function getOwnedRoom(guildId, ownerId) {
  const rooms = guildState(guildId).rooms;
  return Object.values(rooms).find(room => room.ownerId === ownerId) || null;
}

function isTempRoom(guildId, channelId) {
  return Boolean(getRoom(guildId, channelId));
}

function isRoomOwner(guildId, channelId, userId) {
  return getRoom(guildId, channelId)?.ownerId === userId;
}

function setRoomPatch(guildId, channelId, patch) {
  const room = getRoom(guildId, channelId);
  if (!room) return null;
  Object.assign(room, patch, { updatedAt: Date.now() });
  save();
  return room;
}

async function ensureVoiceHub(guild, cfg, botUserId) {
  if (!cfg.voiceDomain?.enabled || !cfg.voiceDomain.autoCreateHub) return null;

  let category = cfg.voiceDomain.categoryId
    ? guild.channels.cache.get(cfg.voiceDomain.categoryId)
    : null;

  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === "∞ VOICE DOMAIN"
    );

    if (!category) {
      category = await guild.channels.create({
        name: "∞ VOICE DOMAIN",
        type: ChannelType.GuildCategory
      }).catch(() => null);
    }

    if (category) cfg.voiceDomain.categoryId = category.id;
  }

  let hub = cfg.voiceDomain.hubChannelId
    ? guild.channels.cache.get(cfg.voiceDomain.hubChannelId)
    : null;

  if (!hub || hub.type !== ChannelType.GuildVoice) {
    hub = guild.channels.cache.find(
      c => c.type === ChannelType.GuildVoice && c.name === "➕ Create Voice"
    );

    if (!hub) {
      hub = await guild.channels.create({
        name: "➕ Create Voice",
        type: ChannelType.GuildVoice,
        parent: category?.id || null,
        userLimit: 1,
        permissionOverwrites: botUserId ? [
          {
            id: botUserId,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.MoveMembers,
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          }
        ] : []
      }).catch(() => null);
    }

    if (hub) cfg.voiceDomain.hubChannelId = hub.id;
  }

  return hub;
}

async function createTempRoom(guild, member, cfg, botUserId) {
  const existing = getOwnedRoom(guild.id, member.id);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.channelId);
    if (existingChannel) {
      await member.voice.setChannel(existingChannel, "Infinity Voice Domain: return owner to existing room").catch(() => {});
      return existingChannel;
    }
    delete guildState(guild.id).rooms[existing.channelId];
  }

  const hub = await ensureVoiceHub(guild, cfg, botUserId);
  if (!hub) return null;

  const categoryId = cfg.voiceDomain.categoryId || hub.parentId || null;

  const room = await guild.channels.create({
    name: buildRoomName(cfg, member),
    type: ChannelType.GuildVoice,
    parent: categoryId,
    userLimit: Number(cfg.voiceDomain.defaultUserLimit || 0),
    permissionOverwrites: [
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      ...(botUserId ? [{
        id: botUserId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }] : [])
    ]
  }).catch(() => null);

  if (!room) return null;

  guildState(guild.id).rooms[room.id] = {
    channelId: room.id,
    ownerId: member.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    locked: false,
    hidden: false,
    panic: false,
    userLimit: room.userLimit || 0,
    coOwners: [],
    blocklist: [],
    queue: [],
    pendingKnocks: {},
    knockHistory: {},
    preset: "gaming",
    autoPrivate: Boolean(cfg.voiceDomain.autoPrivateDefault),
    type: "personal",
    aloneSince: null,
    afkWarned: false,
    panelMessageId: null
  };
  save();

  await member.voice.setChannel(room, "Infinity Voice Domain created").catch(() => {});

  await room.send({
    content: `<@${member.id}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle("👁️ Your Domain is open")
        .setDescription(
          `**${voiceLine("open")}**\n\n` +
          `Welcome to your temporary Voice Domain.\n\n` +
          `You own this room while it exists. Use the buttons below or \`/voice\` commands to control it.\n\n` +
          `🔒 Lock it • 👁️ Hide it • 👥 Set a limit • ✏️ Rename • ✅ Permit users\n` +
          `When everybody leaves, Infinity removes the room automatically.`
        )
        .setColor(0x7dd3fc)
        .setFooter({ text: "Infinity Voice Domain • Six Eyes connected" })
    ],
    components: roomControls(room.id),
    allowedMentions: { users: [member.id] }
  }).catch(() => {});

  await refreshRoomPanel(guild, room.id).catch(() => {});
  return room;
}

async function deleteRoom(guild, channelId, reason = "Infinity Voice Domain cleanup") {
  const gs = guildState(guild.id);
  const room = gs.rooms[channelId];
  if (!room) return false;

  const channel = guild.channels.cache.get(channelId);
  delete gs.rooms[channelId];
  delete gs.raidLocks[channelId];
  save();

  if (!channel) return true;
  return channel.delete(reason).then(() => true).catch(() => false);
}

function scheduleEmptyDelete(guild, channelId, delayMs) {
  if (deleteTimers.has(channelId)) {
    clearTimeout(deleteTimers.get(channelId));
  }

  const timer = setTimeout(async () => {
    deleteTimers.delete(channelId);
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !isTempRoom(guild.id, channelId)) return;
    if (channel.members.size === 0) {
      await deleteRoom(guild, channelId);
    }
  }, Math.max(1000, delayMs));

  deleteTimers.set(channelId, timer);
}

function cancelEmptyDelete(channelId) {
  const timer = deleteTimers.get(channelId);
  if (timer) clearTimeout(timer);
  deleteTimers.delete(channelId);
}

function hasRoomControl(guildId, channelId, userId) {
  const room = getRoom(guildId, channelId);
  return Boolean(room && (room.ownerId === userId || (room.coOwners || []).includes(userId)));
}

const VOICE_LINES = {
  open: [
    "Six Eyes online. Your Domain is ready.",
    "Barrier deployed. Welcome to your personal Infinity.",
    "The room exists now because the Domain allowed it.",
    "Nah, I'd win."
  ],
  lock: [
    "Infinity is active. Nobody gets in without permission.",
    "Barrier sealed. Visitors stop at the edge of the Domain.",
    "Six Eyes closed the door before anyone touched it.",
    "Private Domain established. Aura levels rising."
  ],
  unlock: [
    "Barrier dropped. The Domain is open again.",
    "Infinity relaxed. Visitors may enter.",
    "Six Eyes reopened the gate. Behave yourselves."
  ],
  knock: [
    "Someone is knocking on the Domain. Cute.",
    "Six Eyes spotted a visitor at the barrier.",
    "A presence reached the edge of Infinity.",
    "Visitor detected. The owner decides who crosses the barrier."
  ],
  deny: [
    "Access denied. Infinity says no.",
    "Wrong Domain, wrong day.",
    "The barrier did not recognize that invitation.",
    "Six Eyes verdict: stay outside."
  ],
  allow: [
    "Barrier opened. One guest gets through.",
    "Permission granted. Don't waste the aura.",
    "Six Eyes approved entry. Welcome inside."
  ],
  panic: [
    "Domain Expansion: Emergency Privacy.",
    "Maximum barrier output. Nobody new gets through.",
    "The inner Domain is sealed.",
    "Six Eyes switched from chill to containment."
  ],
  full: [
    "This Domain has reached its limit.",
    "No more cursed energy fits in here. Queue up.",
    "Barrier capacity reached. Wait outside with aura."
  ],
  team: [
    "Teams selected. Try not to embarrass your side.",
    "Match Domains created. Six Eyes picked the squads.",
    "The battlefield is divided. Aura check starts now.",
    "Teams are set. The Domain wants entertainment."
  ],
  raid: [
    "Too many cursed spirits entered at once.",
    "Voice Raid Shield deployed. Infinity closed the gate.",
    "The VC became an invasion. Barrier output increased."
  ],
  afk: [
    "You still alive in there? Six Eyes haven't seen movement for a while.",
    "This Domain is getting suspiciously quiet.",
    "Aura reading: almost zero. AFK suspicion increasing."
  ],
  event: [
    "Domain stability: 100%.",
    "Six Eyes scan complete. Everybody still looks suspicious.",
    "Cursed energy levels: unnecessarily high.",
    "Infinity check complete. Barrier clean. Aura excessive.",
    "Six Eyes ping: the room is still inside reality. Barely."
  ]
}
function voiceLine(type="event") { const list=VOICE_LINES[type]||VOICE_LINES.event; return list[Math.floor(Math.random()*list.length)]; }

async function toggleLock(guild, channel, userId) {
  const room = getRoom(guild.id, channel.id);
  if (!room || !hasRoomControl(guild.id, channel.id, userId)) return null;

  const next = !room.locked;
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    Connect: next ? false : null
  });

  setRoomPatch(guild.id, channel.id, { locked: next });
  await channel.send(next ? `🔒 **${voiceLine("lock")}**` : `🔓 **${voiceLine("unlock")}**`).catch(()=>{});
  await refreshRoomPanel(guild,channel.id).catch(()=>{});
  return next;
}

async function toggleHide(guild, channel, userId) {
  const room = getRoom(guild.id, channel.id);
  if (!room || !hasRoomControl(guild.id, channel.id, userId)) return null;

  const next = !room.hidden;
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: next ? false : null
  });

  // Owner always keeps access.
  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    SendMessages: true,
    ReadMessageHistory: true
  }).catch(() => {});

  setRoomPatch(guild.id, channel.id, { hidden: next });
  await refreshRoomPanel(guild,channel.id).catch(()=>{});
  return next;
}

async function setRoomLimit(guild, channel, userId, limit) {
  const room = getRoom(guild.id, channel.id);
  if (!room || !hasRoomControl(guild.id, channel.id, userId)) return false;

  const safe = Math.max(0, Math.min(99, Number(limit) || 0));
  await channel.setUserLimit(safe, `Infinity Voice Domain owner ${userId}`);
  setRoomPatch(guild.id, channel.id, { userLimit: safe });
  await refreshRoomPanel(guild,channel.id).catch(()=>{});
  return true;
}

async function renameRoom(guild, channel, userId, name) {
  const room = getRoom(guild.id, channel.id);
  if (!room || !hasRoomControl(guild.id, channel.id, userId)) return false;

  const safe = sanitizeName(name).slice(0, 90);
  if (!safe) return false;

  await channel.setName(`👁️ ${safe}`, `Infinity Voice Domain owner ${userId}`);
  return true;
}

async function permitUser(guild, channel, ownerId, targetId, permit = true) {
  const room = getRoom(guild.id, channel.id);
  if (!room || !hasRoomControl(guild.id, channel.id, ownerId)) return false;

  if (permit) {
    await channel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true
    });
  } else {
    await channel.permissionOverwrites.delete(targetId).catch(() => {});
  }
  return true;
}

async function claimRoom(guild, channel, userId) {
  const room = getRoom(guild.id, channel.id);
  if (!room) return { ok: false, reason: "not_temp" };

  if (channel.members.has(room.ownerId)) {
    return { ok: false, reason: "owner_present" };
  }

  if (!channel.members.has(userId)) {
    return { ok: false, reason: "not_inside" };
  }

  const oldOwnerId = room.ownerId;
  setRoomPatch(guild.id, channel.id, { ownerId: userId });

  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    SendMessages: true,
    ReadMessageHistory: true
  }).catch(() => {});

  if (oldOwnerId !== userId) {
    await channel.permissionOverwrites.delete(oldOwnerId).catch(() => {});
  }

  return { ok: true, oldOwnerId };
}

function trackVoiceSession(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!guild || !member || member.user.bot) return;

  const gs = guildState(guild.id);
  const userId = member.id;
  const oldId = oldState.channelId;
  const newId = newState.channelId;
  if (oldId === newId) return;

  const stats = gs.stats[userId] ||= {
    totalMs: 0,
    joins: 0,
    moves: 0,
    sessions: 0,
    longestMs: 0
  };

  const afkId = guild.afkChannelId || null;
  const current = gs.activeSessions[userId];
  if (oldId && current?.joinedAt && current.channelId === oldId && oldId !== afkId) {
    const duration = Math.max(0, Date.now() - current.joinedAt);
    stats.totalMs += duration;
    stats.longestMs = Math.max(stats.longestMs || 0, duration);
    delete gs.activeSessions[userId];
  }
  if (!oldId && newId) { stats.joins += 1; stats.sessions += 1; }
  else if (oldId && newId) stats.moves += 1;
  if (newId && newId !== afkId) {
    gs.activeSessions[userId] = { joinedAt: Date.now(), channelId: newId };
  }

  save();
}

function getVoiceStats(guildId, userId) {
  const gs = guildState(guildId);
  const base = gs.stats[userId] || {
    totalMs: 0,
    joins: 0,
    moves: 0,
    sessions: 0,
    longestMs: 0
  };

  const active = gs.activeSessions[userId];
  const activeMs = active?.joinedAt ? Math.max(0, Date.now() - active.joinedAt) : 0;

  return {
    ...base,
    totalMs: base.totalMs + activeMs,
    currentSessionMs: activeMs,
    active: Boolean(active)
  };
}

function trackChannelJoin(guildId, channelId, windowMs) {
  const key = `${guildId}:${channelId}`;
  const now = Date.now();
  const list = (raidJoinTracker.get(key) || []).filter(ts => now - ts < windowMs);
  list.push(now);
  raidJoinTracker.set(key, list);
  return list.length;
}

async function applyVoiceRaidLock(guild, channel, durationMs) {
  const gs = guildState(guild.id);
  if (gs.raidLocks[channel.id]) return false;

  const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
  let priorConnect = null;
  if (overwrite?.allow.has(PermissionsBitField.Flags.Connect)) priorConnect = true;
  if (overwrite?.deny.has(PermissionsBitField.Flags.Connect)) priorConnect = false;

  gs.raidLocks[channel.id] = {
    priorConnect,
    lockedAt: Date.now(),
    unlockAt: Date.now() + durationMs
  };
  save();

  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    Connect: false
  }).catch(() => {});

  setTimeout(async () => {
    const current = guildState(guild.id).raidLocks[channel.id];
    if (!current) return;

    const fresh = guild.channels.cache.get(channel.id);
    if (fresh) {
      await fresh.permissionOverwrites.edit(guild.roles.everyone, {
        Connect: current.priorConnect
      }).catch(() => {});
    }

    delete guildState(guild.id).raidLocks[channel.id];
    save();
  }, Math.max(1000, durationMs));

  return true;
}

async function recoverRaidLocks(guild) {
  const gs = guildState(guild.id);
  const now = Date.now();

  for (const [channelId, lock] of Object.entries(gs.raidLocks)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      delete gs.raidLocks[channelId];
      continue;
    }

    if (lock.unlockAt <= now) {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        Connect: lock.priorConnect
      }).catch(() => {});
      delete gs.raidLocks[channelId];
      continue;
    }

    const remaining = lock.unlockAt - now;
    setTimeout(async () => {
      const current = guildState(guild.id).raidLocks[channelId];
      if (!current) return;
      const fresh = guild.channels.cache.get(channelId);
      if (fresh) {
        await fresh.permissionOverwrites.edit(guild.roles.everyone, {
          Connect: current.priorConnect
        }).catch(() => {});
      }
      delete guildState(guild.id).raidLocks[channelId];
      save();
    }, remaining);
  }

  save();
}

async function cleanOrphanRooms(guild, cfg) {
  const gs = guildState(guild.id);

  for (const channelId of Object.keys(gs.rooms)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      delete gs.rooms[channelId];
      continue;
    }

    if (channel.members.size === 0) {
      scheduleEmptyDelete(guild, channelId, cfg.voiceDomain.deleteEmptyAfterMs);
    }
  }
  save();
}


async function reconcileVoiceSessions(guild) {
  const gs = guildState(guild.id);
  const now = Date.now();
  const afkId = guild.afkChannelId || null;

  // Never count bot downtime as voice XP. Existing sessions are either re-based to now
  // if the member is still connected, or discarded if they left while Infinity was offline.
  for (const [userId, session] of Object.entries(gs.activeSessions)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const channelId = member?.voice?.channelId || null;
    if (!member || !channelId || channelId === afkId) {
      delete gs.activeSessions[userId];
      continue;
    }
    session.joinedAt = now;
    session.channelId = channelId;
  }

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
    if (channel.id === afkId) continue;
    for (const member of channel.members.values()) {
      if (member.user.bot) continue;
      if (!gs.activeSessions[member.id]) {
        gs.activeSessions[member.id] = { joinedAt: now, channelId: channel.id };
      }
    }
  }
  save();
}
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function livePanelEmbed(channel,room){
  return new EmbedBuilder().setTitle("👁️ Live Voice Domain")
    .setDescription(`**${voiceLine("event")}**\n\nOwner: ${room.ownerId?`<@${room.ownerId}>`:"System"}\nCo-Owners: ${(room.coOwners||[]).length?(room.coOwners||[]).map(id=>`<@${id}>`).join(", "):"None"}\nMembers: **${channel.members.size}/${channel.userLimit||"∞"}**\nLocked: **${room.locked?"YES":"NO"}**\nHidden: **${room.hidden?"YES":"NO"}**\nPanic: **${room.panic?"ACTIVE":"OFF"}**\nPreset: **${room.preset||"gaming"}**\nQueue: **${(room.queue||[]).length}**\nOpen: **${formatDuration(Date.now()-room.createdAt)}**`)
    .setColor(room.panic?0xff3b30:0x7dd3fc).setFooter({text:"Infinity Voice Domain • no audio is recorded"}).setTimestamp();
}
async function refreshRoomPanel(guild,channelId){
  const room=getRoom(guild.id,channelId),channel=guild.channels.cache.get(channelId);if(!room||!channel?.isTextBased())return false;
  const payload={embeds:[livePanelEmbed(channel,room)],components:roomControls(channel.id),allowedMentions:{parse:[]}};
  if(room.panelMessageId){const old=await channel.messages.fetch(room.panelMessageId).catch(()=>null);if(old){await old.edit(payload).catch(()=>{});return true;}}
  const sent=await channel.send(payload).catch(()=>null);if(sent){room.panelMessageId=sent.id;save();return true;}return false;
}

async function panicRoom(guild, channel, userId) {
  const room=getRoom(guild.id,channel.id); if(!room||!hasRoomControl(guild.id,channel.id,userId)) return false;
  await channel.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false,Connect:false}).catch(()=>{});
  for(const id of [room.ownerId,...(room.coOwners||[]),...channel.members.keys()]) if(id) await channel.permissionOverwrites.edit(id,{ViewChannel:true,Connect:true}).catch(()=>{});
  setRoomPatch(guild.id,channel.id,{locked:true,hidden:true,panic:true});
  await channel.send(`🌀 **${voiceLine("panic")}**`).catch(()=>{}); return true;
}
async function addCoOwner(guild,channel,ownerId,targetId,add=true){
  const room=getRoom(guild.id,channel.id); if(!room||room.ownerId!==ownerId||targetId===ownerId)return false;
  if(add){if(!room.coOwners.includes(targetId))room.coOwners.push(targetId);await channel.permissionOverwrites.edit(targetId,{ViewChannel:true,Connect:true,SendMessages:true}).catch(()=>{});}else room.coOwners=room.coOwners.filter(id=>id!==targetId);
  save(); return true;
}
async function transferOwnership(guild,channel,ownerId,targetId){
  const room=getRoom(guild.id,channel.id); if(!room||room.ownerId!==ownerId||targetId===ownerId)return false;
  room.ownerId=targetId; room.coOwners=room.coOwners.filter(id=>id!==targetId); if(!room.coOwners.includes(ownerId))room.coOwners.push(ownerId); save();
  await channel.permissionOverwrites.edit(targetId,{ViewChannel:true,Connect:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{}); return true;
}
async function blockUser(guild,channel,controllerId,targetId,blocked=true){
  const room=getRoom(guild.id,channel.id); if(!room||!hasRoomControl(guild.id,channel.id,controllerId)||targetId===room.ownerId||room.coOwners.includes(targetId))return false;
  if(blocked){if(!room.blocklist.includes(targetId))room.blocklist.push(targetId);await channel.permissionOverwrites.edit(targetId,{ViewChannel:false,Connect:false}).catch(()=>{});}else{room.blocklist=room.blocklist.filter(id=>id!==targetId);await channel.permissionOverwrites.delete(targetId).catch(()=>{});} save(); return true;
}
async function requestKnock(guild,channel,user,cfg){
  const room=getRoom(guild.id,channel.id); if(!room)return{ok:false,reason:"not_room"}; if(room.blocklist.includes(user.id))return{ok:false,reason:"blocked"}; if(!room.locked&&!room.hidden)return{ok:false,reason:"open"};
  const now=Date.now(); const h=(room.knockHistory[user.id]||[]).filter(ts=>now-ts<60000); h.push(now); room.knockHistory[user.id]=h; room.pendingKnocks[user.id]=now; save();
  return {ok:true,count:h.length,repeated:h.length>=Number(cfg.voiceDomain.knockAlertThreshold||3)};
}
async function resolveKnock(guild,channelId,targetId,controllerId,allow){
  const room=getRoom(guild.id,channelId),channel=guild.channels.cache.get(channelId); if(!room||!channel||!hasRoomControl(guild.id,channelId,controllerId))return false; delete room.pendingKnocks[targetId];
  if(allow) await channel.permissionOverwrites.edit(targetId,{ViewChannel:true,Connect:true}).catch(()=>{}); save(); return true;
}
async function joinQueue(guild,channel,userId){
  const room=getRoom(guild.id,channel.id); if(!room)return{ok:false,reason:"not_room"}; if(room.blocklist.includes(userId))return{ok:false,reason:"blocked"}; if(!channel.userLimit||channel.members.size<channel.userLimit)return{ok:false,reason:"space"}; if(!room.queue.includes(userId))room.queue.push(userId); save(); return{ok:true,position:room.queue.indexOf(userId)+1};
}
async function processRoomQueue(guild,channelId){
  const room=getRoom(guild.id,channelId),channel=guild.channels.cache.get(channelId); if(!room||!channel||!room.queue.length)return null; if(channel.userLimit&&channel.members.size>=channel.userLimit)return null;
  while(room.queue.length){const id=room.queue.shift();if(room.blocklist.includes(id))continue;await channel.permissionOverwrites.edit(id,{ViewChannel:true,Connect:true}).catch(()=>{});const u=await guild.client.users.fetch(id).catch(()=>null);if(u)await u.send(`👁️ A spot opened in **${channel.name}** on **${guild.name}**. ${voiceLine("allow")}`).catch(()=>{});save();return id;} save();return null;
}
async function applyPreset(guild,channel,userId,preset){
  const room=getRoom(guild.id,channel.id);if(!room||!hasRoomControl(guild.id,channel.id,userId))return false; const presets={gaming:{limit:0,locked:false,hidden:false},private:{limit:5,locked:true,hidden:true},party:{limit:10,locked:false,hidden:false},study:{limit:6,locked:false,hidden:false},tournament:{limit:5,locked:true,hidden:false}}; const p=presets[preset];if(!p)return false;
  await channel.setUserLimit(p.limit).catch(()=>{});await channel.permissionOverwrites.edit(guild.roles.everyone,{Connect:p.locked?false:null,ViewChannel:p.hidden?false:null}).catch(()=>{});room.preset=preset;room.locked=p.locked;room.hidden=p.hidden;room.panic=false;save();return true;
}
function setAutoPrivate(guildId,channelId,userId,enabled){const room=getRoom(guildId,channelId);if(!room||!hasRoomControl(guildId,channelId,userId))return false;room.autoPrivate=Boolean(enabled);save();return true;}
async function maybeAutoPrivate(guild,channelId){const room=getRoom(guild.id,channelId),channel=guild.channels.cache.get(channelId);if(!room||!channel||!room.autoPrivate||room.locked)return false;const humans=[...channel.members.values()].filter(m=>!m.user.bot);if(humans.length!==2)return false;await channel.permissionOverwrites.edit(guild.roles.everyone,{Connect:false}).catch(()=>{});room.locked=true;save();await channel.send(`🔒 Auto Private: **${voiceLine("lock")}**`).catch(()=>{});return true;}
async function createManagedRoom(guild,{name,ownerId=null,cfg,botUserId,userLimit=0,type="team"}){const room=await guild.channels.create({name:String(name).slice(0,100),type:ChannelType.GuildVoice,parent:cfg.voiceDomain.categoryId||null,userLimit,permissionOverwrites:[...(ownerId?[{id:ownerId,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.Speak,PermissionsBitField.Flags.SendMessages]}]:[]),...(botUserId?[{id:botUserId,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.MoveMembers,PermissionsBitField.Flags.ManageChannels,PermissionsBitField.Flags.SendMessages]}]:[])]}).catch(()=>null);if(!room)return null;guildState(guild.id).rooms[room.id]={channelId:room.id,ownerId,type,createdAt:Date.now(),updatedAt:Date.now(),locked:false,hidden:false,panic:false,userLimit:room.userLimit||0,coOwners:[],blocklist:[],queue:[],pendingKnocks:{},knockHistory:{},preset:type==="party"?"party":"tournament",autoPrivate:false,aloneSince:null,afkWarned:false,panelMessageId:null};save();return room;}
async function createTeamRooms(guild,sourceChannel,count,cfg,botUserId,label="Team"){const members=[...sourceChannel.members.values()].filter(m=>!m.user.bot);if(members.length<2)return{ok:false,channels:[]};const n=Math.max(2,Math.min(8,Number(count)||2)),shuffled=[...members].sort(()=>Math.random()-.5),teams=Array.from({length:n},()=>[]);shuffled.forEach((m,i)=>teams[i%n].push(m));const channels=[];for(let i=0;i<teams.length;i++){if(!teams[i].length)continue;const r=await createManagedRoom(guild,{name:`⚔️ ${label} ${i+1}`,cfg,botUserId,userLimit:teams[i].length+1,type:"team"});if(!r)continue;channels.push(r);for(const m of teams[i])await m.voice.setChannel(r,"Infinity team generator").catch(()=>{});await r.send(`⚔️ **${voiceLine("team")}**`).catch(()=>{});}return{ok:channels.length>=2,channels,teams};}
async function createMatchRooms(guild,sourceChannel,mode,cfg,botUserId){const size=mode==="2v2"?4:2,members=[...sourceChannel.members.values()].filter(m=>!m.user.bot);if(members.length<size)return{ok:false,channels:[]};const picked=[...members].sort(()=>Math.random()-.5).slice(0,size),fake={members:new Map(picked.map(m=>[m.id,m]))};return createTeamRooms(guild,fake,2,cfg,botUserId,mode.toUpperCase());}
async function createParty(guild,member,game,maxPlayers,cfg,botUserId){const room=await createManagedRoom(guild,{name:`🎮 ${sanitizeName(game)} • ${sanitizeName(member.displayName)}`,ownerId:member.id,cfg,botUserId,userLimit:Math.max(2,Math.min(25,Number(maxPlayers)||5)),type:"party"});if(room){guildState(guild.id).parties[room.id]={channelId:room.id,ownerId:member.id,game:sanitizeName(game),maxPlayers:room.userLimit,createdAt:Date.now()};save();}return room;}
function listParties(guildId){return Object.values(guildState(guildId).parties).sort((a,b)=>b.createdAt-a.createdAt);}
function getVoiceLeaderboard(guildId,limit=10){const gs=guildState(guildId),now=Date.now();return Object.entries(gs.stats).map(([userId,s])=>{const a=gs.activeSessions[userId],extra=a?.joinedAt?Math.max(0,now-a.joinedAt):0;return{userId,totalMs:(s.totalMs||0)+extra,sessions:s.sessions||0};}).sort((a,b)=>b.totalMs-a.totalMs).slice(0,limit);}
function voiceXpFromMs(ms,cfg){const step=Math.max(1,Number(cfg.voiceDomain.xpMinutesPerPoint||5));const xp=Math.floor(ms/(step*60000));return{xp,level:Math.floor(Math.sqrt(xp/10))};}
async function smartAfkSweep(guild,cfg){const gs=guildState(guild.id),now=Date.now(),warn=Math.max(1,Number(cfg.voiceDomain.afkWarnMinutes||20))*60000,move=Math.max(Number(cfg.voiceDomain.afkMoveMinutes||30),Number(cfg.voiceDomain.afkWarnMinutes||20))*60000;for(const room of Object.values(gs.rooms)){const ch=guild.channels.cache.get(room.channelId);if(!ch||!room.ownerId)continue;const humans=[...ch.members.values()].filter(m=>!m.user.bot);if(humans.length===1){room.aloneSince ||= now;const d=now-room.aloneSince;if(d>=warn&&!room.afkWarned){room.afkWarned=true;await ch.send(`😴 <@${humans[0].id}> — **${voiceLine("afk")}**`).catch(()=>{});}if(d>=move&&guild.afkChannel&&humans[0].voice.channelId===ch.id)await humans[0].voice.setChannel(guild.afkChannel,"Infinity Smart AFK").catch(()=>{});}else{room.aloneSince=null;room.afkWarned=false;}}save();}

module.exports = {
  voiceLine,
  hasRoomControl,
  refreshRoomPanel,
  ensureVoiceHub,
  createTempRoom,
  deleteRoom,
  scheduleEmptyDelete,
  cancelEmptyDelete,
  getRoom,
  getOwnedRoom,
  isTempRoom,
  isRoomOwner,
  roomControls,
  toggleLock,
  toggleHide,
  setRoomLimit,
  renameRoom,
  permitUser,
  claimRoom,
  panicRoom,
  addCoOwner,
  transferOwnership,
  blockUser,
  requestKnock,
  resolveKnock,
  joinQueue,
  processRoomQueue,
  applyPreset,
  setAutoPrivate,
  maybeAutoPrivate,
  createTeamRooms,
  createMatchRooms,
  createParty,
  listParties,
  getVoiceLeaderboard,
  voiceXpFromMs,
  smartAfkSweep,
  trackVoiceSession,
  getVoiceStats,
  trackChannelJoin,
  applyVoiceRaidLock,
  recoverRaidLocks,
  cleanOrphanRooms,
  reconcileVoiceSessions,
  formatDuration
};
