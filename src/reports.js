const { recentForGuild } = require("./incidents");
const { pendingForGuild } = require("./appeals");
const { activeCasesForGuild } = require("./mediation");

function reportForGuild(guildId, hours=24) {
  const cutoff=Date.now()-hours*3600000;
  const incidents=recentForGuild(guildId,3000).filter(x=>x.createdAt>=cutoff);
  const byCategory={}; const byAction={};
  for (const i of incidents) { byCategory[i.category]=(byCategory[i.category]||0)+1; byAction[i.action]=(byAction[i.action]||0)+1; }
  const timeouts=incidents.filter(i=>/timeout/i.test(i.action||'') && !/failed|removed/i.test(i.action||'')).length;
  return { hours, incidents, byCategory, byAction, timeouts, pendingAppeals:pendingForGuild(guildId,100).length, activeMediations:activeCasesForGuild(guildId).length };
}

function compactCounts(obj, limit=8) {
  const entries=Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,limit);
  return entries.length ? entries.map(([k,v])=>`• **${k}**: ${v}`).join("\n") : "None";
}
module.exports={reportForGuild,compactCounts};
