const assert = require('assert');
const Module = require('module');

// serverBoss.js needs discord.js for embeds/buttons in production. The logic test only
// needs constants, so stub the package to keep npm test reproducible without npm install.
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'discord.js') {
    class Dummy { constructor(){ return this; } setTitle(){return this;} setDescription(){return this;} addFields(){return this;} setColor(){return this;} setFooter(){return this;} setTimestamp(){return this;} setCustomId(){return this;} setLabel(){return this;} setEmoji(){return this;} setStyle(){return this;} setDisabled(){return this;} addComponents(){return this;} }
    return {
      EmbedBuilder: Dummy,
      ActionRowBuilder: Dummy,
      ButtonBuilder: Dummy,
      ButtonStyle: { Primary:1, Secondary:2, Success:3 },
      PermissionsBitField: { Flags: { Administrator: 8n } },
      ChannelType: { GuildText:0, GuildVoice:2, GuildAnnouncement:5, GuildStageVoice:13 }
    };
  }
  return originalLoad(request, parent, isMain);
};

const boss = require('../src/events/serverBoss');
const state = boss.debugState('TEST-GUILD-BOSS');
state.active = {
  status: 'active',
  tasks: [
    { type:'messages', target:100 },
    { type:'active_channels', target:3 },
    { type:'contributors', target:4 }
  ],
  metrics: {
    validMessages: 42,
    channelMessages: { a:3, b:5, c:2, d:3 },
    userMessages: { u1:3, u2:5, u3:2, u4:3, u5:8 },
    participants:['u1','u2','u3','u4','u5']
  }
};

assert.strictEqual(boss.taskProgress(state.active, state.active.tasks[0]), 42);
assert.strictEqual(boss.taskProgress(state.active, state.active.tasks[1]), 3);
assert.strictEqual(boss.taskProgress(state.active, state.active.tasks[2]), 4);

console.log('server-boss: PASS');
