const assert = require("assert");
const mediation = require("../src/security/mediation");
const { classifyConflict } = require("../src/security/mediatorAI");
const { analyzeMessageLinks } = require("../src/security/linkSafety");
const { loadJson, saveJson } = require("../src/security/jsonStore");
const fs = require("fs");
const path = require("path");
const os = require("os");

const cfg = { mediation: { mutualWindowMs: 180000 } };

function mockMessage({ id, guildId="g1", channelId="c1", userId, content, mentions=[], replyTo=null, authors={} }) {
  const users = new Map(mentions.map(x => [x, { id:x, bot:false }]));
  return {
    id, guild:{ id:guildId }, channel:{
      id:channelId,
      messages:{ fetch: async rid => replyTo && rid === replyTo.id ? { author:{ id:replyTo.userId, bot:false } } : null }
    },
    author:{ id:userId, bot:false },
    content,
    mentions:{ users },
    reference: replyTo ? { messageId:replyTo.id } : null
  };
}

async function observeSequence(items, channelId="c1") {
  mediation._test._resetConflictState();
  const results=[];
  for (let i=0;i<items.length;i++) {
    const x=items[i];
    const msg=mockMessage({ id:`m${i+1}`, channelId, ...x });
    results.push(await mediation.observeConflictMessage(msg,cfg));
  }
  return results;
}

async function main(){
  // Quote / reported speech false positive regression.
  assert.equal(mediation._test.directHostilityText('Max hat gestern wirklich gesagt „du hurensohn fick dich“ 💀'), '');
  assert.equal(mediation._test.directHostilityText('Max hat gestern gesagt du hurensohn fick dich'), '');
  assert.ok(mediation._test.directHostilityText('Max hat gesagt „du idiot“ aber du bist auch ein idiot').includes('aber du bist auch ein idiot'));

  // Obfuscation still detected.
  assert.ok(mediation._test.hasAny('du h.u.r.e.n.s.o.h.n', ['hurensohn']));
  assert.ok(mediation._test.hasAny('f1ck dich', ['fick dich']));

  // User's original serious dispute -> mutual.
  let r=await observeSequence([
    {userId:'A',content:'du behinderter hurensohn fick dich'},
    {userId:'B',content:'Bro was habe ich dir getan'},
    {userId:'A',content:'Du hast mich gescammt, du idiot'},
    {userId:'B',content:'nein du hund'}
  ], 'orig');
  assert.equal(r.at(-1).kind,'mutual_candidate');

  // Friendly banter -> warning candidate, not mediation.
  r=await observeSequence([
    {userId:'A',content:'du hs 😭'},
    {userId:'B',content:'halt maul du hund 😂'},
    {userId:'A',content:'HAHA komm vc'},
    {userId:'B',content:'bin unterwegs'}
  ], 'friendly');
  const snapFriendly = mediation.getConflictReviewSnapshot({guildId:'g1',channelId:'friendly',userA:'A',userB:'B',cfg});
  assert.equal(snapFriendly.kind,'friendly_banter_candidate');

  // Distress prevents friendly downgrade.
  r=await observeSequence([
    {userId:'A',content:'du idiot 😂'},
    {userId:'B',content:'bro was habe ich dir getan'},
    {userId:'A',content:'du hund 😂'}
  ], 'distress');
  const snapDistress=mediation.getConflictReviewSnapshot({guildId:'g1',channelId:'distress',userA:'A',userB:'B',cfg});
  assert.notEqual(snapDistress.kind,'friendly_banter_candidate');

  // Busy-channel target safety: don't assign an implicit "du idiot" to a random third user.
  mediation._test._resetConflictState();
  await mediation.observeConflictMessage(mockMessage({id:'b1',channelId:'busy',userId:'B',content:'kennt jemand das game?'}),cfg);
  await mediation.observeConflictMessage(mockMessage({id:'b2',channelId:'busy',userId:'C',content:'ja ich'}),cfg);
  const busy=await mediation.observeConflictMessage(mockMessage({id:'b3',channelId:'busy',userId:'A',content:'du idiot'}),cfg);
  assert.equal(busy.kind,'unresolved_hostility');
  assert.equal(busy.userB,null);

  // Repeated mild targeted insults work without Gemini.
  r=await observeSequence([
    {userId:'A',content:'du idiot',mentions:['B']},
    {userId:'B',content:'hör auf',mentions:['A']},
    {userId:'A',content:'du bist dumm',mentions:['B']}
  ], 'repeat');
  const snapRepeat=mediation.getConflictReviewSnapshot({guildId:'g1',channelId:'repeat',userA:'A',userB:'B',cfg});
  assert.equal(snapRepeat.kind,'unilateral_candidate');
  const fallback=await classifyConflict({apiKey:'',model:'x',guildName:'x',candidate:snapRepeat});
  assert.equal(fallback.classification,'unilateral_attack');
  assert.ok(fallback.confidence>=0.92);

  // Link Shield: official links safe, scheme-less typosquats and fake login domains caught.
  let link=analyzeMessageLinks('discord.com/channels/123/456');
  assert.equal(link.critical,false);
  assert.equal(link.maxRisk,0);

  link=analyzeMessageLinks('claim here: discrod-login.com/nitro');
  assert.equal(link.hasLinks,true);
  assert.equal(link.critical,true);

  link=analyzeMessageLinks('https://discord.com.evil-example.xyz/gift/claim');
  assert.equal(link.critical,true);

  // Offline/no-AI phishing bait + shortener must still be high risk.
  link=analyzeMessageLinks('FREE NITRO claim now bit.ly/freegift');
  assert.equal(link.critical,true);

  // Crash-safe JSON store recovers last known-good .bak if main file is corrupt.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-json-test-'));
  const storeFile = path.join(tmpDir, 'store.json');
  saveJson(storeFile, {version:1});
  saveJson(storeFile, {version:2});
  fs.writeFileSync(storeFile, '{broken json');
  const recovered = loadJson(storeFile, {version:0});
  assert.equal(recovered.version, 1);
  fs.rmSync(tmpDir, {recursive:true, force:true});

  console.log('PASS: quote protection');
  console.log('PASS: obfuscated insult normalization');
  console.log('PASS: original dispute -> mutual mediation candidate');
  console.log('PASS: friendly banter -> aura warning candidate');
  console.log('PASS: distress blocks friendly downgrade');
  console.log('PASS: busy-channel target safety');
  console.log('PASS: repeated mild harassment fallback');
  console.log('PASS: strengthened link shield');
  console.log('PASS: offline scam bait + shortener detection');
  console.log('PASS: crash-safe JSON backup recovery');
}

main().catch(err=>{ console.error(err); process.exit(1); });
