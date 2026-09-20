const assert = require('assert');
const core = require('../src/games/cursedRealmsCore');

const p = core.defaultProfile('u1');
assert.equal(p.level, 1);
assert.equal(core.gradeFor(p), 'Grade 4');
assert.equal(core.currentArea(p).id, 'tokyo_school');
assert(core.unlockedAreas(p).length >= 1);

// Deterministic rewards / leveling.
const before = p.level;
core.addRewards(p, 100000, 5000);
assert(p.level > before, 'large XP reward should level player');
assert(p.yen >= 7500, 'yen reward should persist');

// Technique roll is in-game currency only and can be deterministic.
p.yen = 100000;
p.techniquePity = 39;
const roll = core.rollTechnique(p, () => 0.99);
assert(roll.ok, 'roll should succeed');
assert.equal(roll.technique.rarity, 'Mythic', '40th pity roll must be Mythic');
assert.equal(p.techniquePity, 0, 'Mythic resets pity');

// Quest progression.
p.areaId = 'tokyo_school';
const q = core.startQuest(p);
assert(q.target >= 4);
let completed;
for (let i = 0; i < q.target; i++) completed = core.applyQuestKill(p, q.enemyName);
assert(completed.completed, 'quest must complete at target count');
assert.equal(p.activeQuest, null);

// Domain only works for domain technique at mastery 150+.
p.techniqueId = 'limitless';
p.mastery = 149;
assert.equal(core.domainDamage(p, () => 0), 0);
p.mastery = 150;
assert(core.domainDamage(p, () => 0) > 0);

// Boss drop always returns a supported reward.
const drop = core.dropFromBoss(p, () => 0.01);
assert.equal(drop.type, 'tool');
assert(p.inventory.includes('inverted_spear'));

console.log('Cursed Realms core tests: PASS');
