const fs = require("fs");
const path = require("path");
const { loadJson, saveJson } = require("./jsonStore");
const crypto = require("crypto");
const { ChannelType } = require("discord.js");

const DIR = path.join(__dirname, "..", "..", "data", "backups");
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function fileFor(guildId) { return path.join(DIR, `${guildId}.json`); }
function load(guildId) { return loadJson(fileFor(guildId), []); }
function save(guildId, items) { saveJson(fileFor(guildId), items); }
function id() { return `BKP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`; }

function backupDigest(backup) {
  const clone = JSON.parse(JSON.stringify(backup));
  delete clone.integrity;
  return crypto.createHash("sha256").update(JSON.stringify(clone)).digest("hex");
}

function verifyBackup(backup) {
  if (!backup) return { ok:false, legacy:false, reason:"missing backup" };
  if (!backup.integrity?.digest) return { ok:true, legacy:true, reason:"legacy backup without digest" };
  const digest = backupDigest(backup);
  return { ok:digest === backup.integrity.digest, legacy:false, expected:backup.integrity.digest, actual:digest, reason:digest === backup.integrity.digest ? "integrity verified" : "digest mismatch" };
}

function serializeOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()].map(o => ({
    id:o.id, type:o.type, allow:o.allow.bitfield.toString(), deny:o.deny.bitfield.toString()
  }));
}

async function createBackup(guild, maxBackups=10) {
  await Promise.all([guild.channels.fetch().catch(()=>null), guild.roles.fetch().catch(()=>null)]);
  const backup = {
    id:id(), createdAt:Date.now(), guildId:guild.id, guildName:guild.name,
    everyonePermissions:guild.roles.everyone.permissions.bitfield.toString(),
    roles:[...guild.roles.cache.values()].filter(r=>!r.managed).map(r=>({
      id:r.id, name:r.name, color:r.color, hoist:r.hoist, mentionable:r.mentionable,
      position:r.position, permissions:r.permissions.bitfield.toString(), everyone:r.id===guild.roles.everyone.id
    })),
    channels:[...guild.channels.cache.values()].map(c=>({
      id:c.id, name:c.name, type:c.type, parentId:c.parentId||null,
      position:c.rawPosition||0, topic:c.topic||null, nsfw:Boolean(c.nsfw),
      rateLimitPerUser:c.rateLimitPerUser||0, userLimit:c.userLimit||0,
      bitrate:c.bitrate||null, rtcRegion:c.rtcRegion||null,
      permissionOverwrites:serializeOverwrites(c)
    }))
  };
  backup.schemaVersion = 2;
  backup.integrity = { algorithm:"sha256", digest:backupDigest(backup) };
  const items=load(guild.id); items.push(backup);
  while(items.length>Math.max(1,maxBackups)) items.shift();
  save(guild.id,items); return backup;
}

function listBackups(guildId) { return load(guildId).slice().reverse(); }
function getBackup(guildId, backupId) { return load(guildId).find(x=>x.id===backupId)||null; }

async function restoreBackup(guild, backup) {
  const integrity = verifyBackup(backup);
  const result={ rolesUpdated:0, rolesCreated:0, rolePositions:0, channelsUpdated:0, channelsCreated:0, channelPositions:0, failed:0, skippedOverwrites:0, integrity };
  if (!integrity.ok) { result.failed=1; result.integrityError=true; return result; }
  await Promise.all([guild.channels.fetch().catch(()=>null), guild.roles.fetch().catch(()=>null)]);
  const roleMap = new Map([[guild.roles.everyone.id, guild.roles.everyone.id]]);

  // Restore @everyone separately; older backups may not have the explicit field.
  const everyoneBackup = backup.roles?.find(r=>r.everyone);
  const everyonePerms = backup.everyonePermissions || everyoneBackup?.permissions;
  if (everyonePerms) {
    try {
      await guild.roles.everyone.setPermissions(BigInt(everyonePerms), `Infinity restore ${backup.id}: @everyone permissions`);
      result.rolesUpdated++;
    } catch { result.failed++; }
  }

  for (const r of (backup.roles||[]).filter(x=>!x.everyone).sort((a,b)=>a.position-b.position)) {
    let role=guild.roles.cache.get(r.id);
    try {
      if (role && role.editable) {
        await role.edit({ name:r.name, color:r.color, hoist:r.hoist, mentionable:r.mentionable, permissions:BigInt(r.permissions), reason:`Infinity restore ${backup.id}` });
        result.rolesUpdated++;
      } else if (!role) {
        role=await guild.roles.create({ name:r.name, color:r.color, hoist:r.hoist, mentionable:r.mentionable, permissions:BigInt(r.permissions), reason:`Infinity restore ${backup.id}` });
        result.rolesCreated++;
      }
      if (role) roleMap.set(r.id,role.id);
    } catch { result.failed++; }
  }

  // Batch role positions where Discord allows it. This is more reliable than assuming create order.
  try {
    const rolePositions=(backup.roles||[])
      .filter(r=>!r.everyone && roleMap.get(r.id))
      .map(r=>({ role:roleMap.get(r.id), position:r.position }));
    if (rolePositions.length) {
      await guild.roles.setPositions(rolePositions);
      result.rolePositions=rolePositions.length;
    }
  } catch { result.failed++; }

  const channelMap=new Map();
  for (const c of backup.channels||[]) if (guild.channels.cache.has(c.id)) channelMap.set(c.id,c.id);
  const supported=new Set([
    ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice, ChannelType.GuildStageVoice
  ]);

  function overwriteData(items=[]) {
    const out=[];
    for (const o of items) {
      const isRole = Number(o.type) === 0;
      let mapped = o.id;
      if (isRole) {
        mapped = roleMap.get(o.id) || (guild.roles.cache.has(o.id) ? o.id : null);
        if (!mapped) { result.skippedOverwrites++; continue; }
      }
      out.push({ id:mapped, type:o.type, allow:BigInt(o.allow), deny:BigInt(o.deny) });
    }
    return out;
  }

  for (const c of (backup.channels||[]).filter(x=>x.type===ChannelType.GuildCategory).sort((a,b)=>a.position-b.position)) {
    let ch=guild.channels.cache.get(c.id);
    try {
      if (ch) {
        await ch.edit({ name:c.name, permissionOverwrites:overwriteData(c.permissionOverwrites), reason:`Infinity restore ${backup.id}` });
        result.channelsUpdated++;
      } else {
        ch=await guild.channels.create({ name:c.name, type:ChannelType.GuildCategory, permissionOverwrites:overwriteData(c.permissionOverwrites), reason:`Infinity restore ${backup.id}` });
        result.channelsCreated++;
      }
      if (ch) channelMap.set(c.id,ch.id);
    } catch { result.failed++; }
  }

  for (const c of (backup.channels||[]).filter(x=>x.type!==ChannelType.GuildCategory && supported.has(x.type)).sort((a,b)=>a.position-b.position)) {
    let ch=guild.channels.cache.get(c.id);
    const parent=channelMap.get(c.parentId)||c.parentId||null;
    const common={ name:c.name, parent, permissionOverwrites:overwriteData(c.permissionOverwrites), reason:`Infinity restore ${backup.id}` };
    try {
      if (ch) {
        const edit={ ...common };
        if (c.type===ChannelType.GuildText || c.type===ChannelType.GuildAnnouncement) Object.assign(edit,{ topic:c.topic, nsfw:c.nsfw, rateLimitPerUser:c.rateLimitPerUser });
        if (c.type===ChannelType.GuildVoice) Object.assign(edit,{ userLimit:c.userLimit, ...(c.bitrate?{bitrate:c.bitrate}:{}) });
        await ch.edit(edit); result.channelsUpdated++;
      } else {
        const create={ ...common, type:c.type };
        if (c.type===ChannelType.GuildText || c.type===ChannelType.GuildAnnouncement) Object.assign(create,{ topic:c.topic, nsfw:c.nsfw, rateLimitPerUser:c.rateLimitPerUser });
        if (c.type===ChannelType.GuildVoice) Object.assign(create,{ userLimit:c.userLimit, ...(c.bitrate?{bitrate:c.bitrate}:{}) });
        ch=await guild.channels.create(create); result.channelsCreated++;
      }
      if (ch) channelMap.set(c.id,ch.id);
    } catch { result.failed++; }
  }

  try {
    const channelPositions=(backup.channels||[])
      .filter(c=>supported.has(c.type) && channelMap.get(c.id))
      .map(c=>({ channel:channelMap.get(c.id), position:c.position }));
    if (channelPositions.length) {
      await guild.channels.setPositions(channelPositions);
      result.channelPositions=channelPositions.length;
    }
  } catch { result.failed++; }

  return result;
}

module.exports={ createBackup, listBackups, getBackup, restoreBackup, verifyBackup, backupDigest };
