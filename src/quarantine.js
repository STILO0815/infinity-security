const { createIncident, updateIncident } = require("./incidents");
const { sendCaughtDm } = require("./aura");
const { sendLog, sendOwnerTimeoutDm } = require("./actions");

function fmt(minutes){ if(minutes>=1440&&minutes%1440===0)return `${minutes/1440} day timeout`; if(minutes>=60&&minutes%60===0)return `${minutes/60} hour timeout`; return `${minutes} minute timeout`; }

async function applyQuarantine(guild,user,cfg,minutes,reason,actorId){
  const safe=Math.max(1,Math.min(40320,Number(minutes)||cfg.quarantine.defaultMinutes||1440));
  const incident=createIncident({guildId:guild.id,userId:user.id,category:'quarantine',severity:'high',reason:`Manual quarantine by ${actorId}: ${reason}`,action:'pending timeout',metadata:{actorId,timeoutMinutes:safe}});
  const member=await guild.members.fetch(user.id).catch(()=>null);
  if(!member?.moderatable){ updateIncident(incident.id,{action:'timeout failed'}); return {ok:false,incident}; }
  const ok=await member.timeout(safe*60000,`Infinity Security ${incident.id}: ${reason}`).then(()=>true).catch(()=>false);
  if(!ok){ updateIncident(incident.id,{action:'timeout failed'}); return {ok:false,incident}; }
  const actionText=fmt(safe); updateIncident(incident.id,{action:actionText});
  await sendCaughtDm(member,incident,actionText,guild.name,cfg);
  await sendOwnerTimeoutDm(guild,incident,actionText);
  await sendLog(guild,cfg,'Manual quarantine',`<@${user.id}> received **${actionText}**.\nReason: ${reason}\nIncident: \`${incident.id}\``,'warn');
  return {ok:true,incident,actionText};
}

async function releaseQuarantine(guild,user,cfg,actorId){
  const member=await guild.members.fetch(user.id).catch(()=>null); if(!member)return false;
  const ok=await member.timeout(null,`Infinity Security manual release by ${actorId}`).then(()=>true).catch(()=>false);
  if(ok) await sendLog(guild,cfg,'Timeout released',`<@${user.id}> timeout was removed manually by <@${actorId}>.`);
  return ok;
}
module.exports={applyQuarantine,releaseQuarantine};
