const { ChannelType, PermissionsBitField } = require("discord.js");
const { commit } = require("../config");
const { lockdownGuild, unlockGuild } = require("./actions");

async function activateEmergency(guild, cfg, userId) {
  if (cfg.emergency.active) return { already:true, textLocked:0, voiceLocked:0 };
  cfg.emergency.active=true; cfg.emergency.startedAt=Date.now(); cfg.emergency.startedBy=userId;
  cfg.emergency.previousMode=cfg.mode; cfg.emergency.previousAuraPublic=cfg.aura.publicReplies; cfg.emergency.previousVoiceDomainEnabled=cfg.voiceDomain.enabled;
  cfg.emergency.lockdownWasAlreadyActive=Boolean(cfg.lockdown.active); cfg.emergency.voiceSnapshot={};
  cfg.mode='enforce'; cfg.aura.publicReplies=false; cfg.voiceDomain.enabled=false;
  const textLocked = cfg.lockdown.active ? 0 : await lockdownGuild(guild,cfg);
  let voiceLocked=0;
  for (const ch of guild.channels.cache.values()) {
    if (ch.type!==ChannelType.GuildVoice && ch.type!==ChannelType.GuildStageVoice) continue;
    const ow=ch.permissionOverwrites.cache.get(guild.roles.everyone.id); let prior=null;
    if (ow?.allow.has(PermissionsBitField.Flags.Connect)) prior=true;
    if (ow?.deny.has(PermissionsBitField.Flags.Connect)) prior=false;
    cfg.emergency.voiceSnapshot[ch.id]=prior;
    try { await ch.permissionOverwrites.edit(guild.roles.everyone,{Connect:false}); voiceLocked++; } catch {}
  }
  commit(); return { already:false,textLocked,voiceLocked };
}

async function deactivateEmergency(guild,cfg) {
  if (!cfg.emergency.active) return { already:true,textUnlocked:0,voiceUnlocked:0 };
  let textUnlocked=0;
  if (!cfg.emergency.lockdownWasAlreadyActive && cfg.lockdown.active) textUnlocked=await unlockGuild(guild,cfg);
  let voiceUnlocked=0;
  for (const [id,prior] of Object.entries(cfg.emergency.voiceSnapshot||{})) {
    const ch=guild.channels.cache.get(id); if(!ch) continue;
    try { await ch.permissionOverwrites.edit(guild.roles.everyone,{Connect:prior}); voiceUnlocked++; } catch {}
  }
  cfg.mode=cfg.emergency.previousMode||'alert'; cfg.aura.publicReplies=cfg.emergency.previousAuraPublic ?? true; cfg.voiceDomain.enabled=cfg.emergency.previousVoiceDomainEnabled ?? true;
  cfg.emergency.active=false; cfg.emergency.startedAt=null; cfg.emergency.startedBy=null; cfg.emergency.previousMode=null; cfg.emergency.previousAuraPublic=null; cfg.emergency.previousVoiceDomainEnabled=null; cfg.emergency.lockdownWasAlreadyActive=false; cfg.emergency.voiceSnapshot={};
  commit(); return { already:false,textUnlocked,voiceUnlocked };
}
module.exports={activateEmergency,deactivateEmergency};
