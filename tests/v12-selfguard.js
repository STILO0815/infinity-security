const assert = require('assert');
const Module = require('module');

const Flags = Object.freeze({
  ViewAuditLog: 1n << 0n,
  ManageChannels: 1n << 1n,
  ManageRoles: 1n << 2n,
  ModerateMembers: 1n << 3n,
  ManageMessages: 1n << 4n,
  ManageWebhooks: 1n << 5n,
  ViewChannel: 1n << 6n,
  SendMessages: 1n << 7n,
  EmbedLinks: 1n << 8n,
  ReadMessageHistory: 1n << 9n,
  MoveMembers: 1n << 10n,
  Administrator: 1n << 11n,
  KickMembers: 1n << 12n,
  BanMembers: 1n << 13n
});

class MockPermissionsBitField {
  static Flags = Flags;
  constructor(bits = 0n) {
    if (bits instanceof MockPermissionsBitField) this.bitfield = bits.bitfield;
    else if (Array.isArray(bits)) this.bitfield = bits.reduce((v, x) => v | BigInt(x), 0n);
    else this.bitfield = BigInt(bits || 0);
  }
  has(flag) { flag = BigInt(flag); return (this.bitfield & flag) === flag; }
  toArray() { return Object.values(Flags).filter(flag => this.has(flag)); }
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'discord.js') return { PermissionsBitField: MockPermissionsBitField };
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildReinviteUrl,
  assessSelfProtection,
  protectionSummary
} = require('../src/security/selfProtection');

function role(id, name, position, flags = []) {
  return { id, name, position, permissions: new MockPermissionsBitField(flags) };
}

function member(id, username, highest, allRoles, flags = []) {
  return {
    id,
    user: { id, username, tag: `${username}#0001` },
    roles: { highest, cache: new Map(allRoles.map(r => [r.id, r])) },
    permissions: new MockPermissionsBitField(flags)
  };
}

function guildFixture({ exposed = false } = {}) {
  const everyone = role('g1', '@everyone', 0, []);
  const botFlags = [
    Flags.ViewAuditLog, Flags.ModerateMembers, Flags.ManageChannels, Flags.ManageRoles,
    Flags.ManageMessages, Flags.ManageWebhooks, Flags.ViewChannel, Flags.SendMessages,
    Flags.EmbedLinks, Flags.ReadMessageHistory, Flags.MoveMembers
  ];
  const botRole = role('botrole', 'Infinity Security', 10, botFlags);
  const highRole = role('high', 'Senior Staff', 15, []);
  const kickRole = role('kick', 'Kick Tool', 5, [Flags.KickMembers]);

  const bot = member('bot', 'Infinity', botRole, [everyone, botRole], botFlags);
  const staff = member(
    'staff', 'Staff', exposed ? highRole : kickRole,
    exposed ? [everyone, highRole, kickRole] : [everyone, kickRole],
    [Flags.KickMembers]
  );
  const owner = member('owner', 'Owner', highRole, [everyone, highRole], [Flags.Administrator]);
  const roles = [everyone, botRole, highRole, kickRole];
  const members = new Map([[bot.id, bot], [staff.id, staff], [owner.id, owner]]);

  return {
    id: 'g1', name: 'Test Guild', ownerId: 'owner', memberCount: members.size,
    roles: { cache: new Map(roles.map(r => [r.id, r])) },
    members: { me: bot, cache: members, fetch: async () => members, fetchMe: async () => bot }
  };
}

(async () => {
  const safe = await assessSelfProtection(guildFixture({ exposed:false }), { fetchMembers:true });
  assert.equal(safe.status, 'OWNER_ONLY');
  assert.equal(safe.dangerousMembers.length, 0);
  assert.match(protectionSummary(safe), /OWNER-ONLY/);

  const exposed = await assessSelfProtection(guildFixture({ exposed:true }), { fetchMembers:true });
  assert.equal(exposed.status, 'EXPOSED');
  assert.equal(exposed.dangerousMembers.length, 1);
  assert.equal(exposed.dangerousMembers[0].id, 'staff');
  assert.equal(exposed.dangerousMembers[0].kick, true);
  // Regression: hierarchy can come from a high role while Kick permission comes from another lower role.
  assert.equal(exposed.dangerousMembers[0].highestRoleId, 'high');

  const url = new URL(buildReinviteUrl('123456789'));
  assert.equal(url.searchParams.get('client_id'), '123456789');
  const perms = new MockPermissionsBitField(BigInt(url.searchParams.get('permissions')));
  assert.equal(perms.has(Flags.ModerateMembers), true);
  assert.equal(perms.has(Flags.ViewAuditLog), true);
  assert.equal(perms.has(Flags.KickMembers), false);
  assert.equal(perms.has(Flags.BanMembers), false);

  console.log('PASS: Self-Guard hierarchy + recovery invite');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
