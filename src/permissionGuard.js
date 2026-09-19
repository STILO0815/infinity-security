const { PermissionsBitField } = require("discord.js");

const DANGEROUS = [
  [PermissionsBitField.Flags.Administrator, "Administrator"],
  [PermissionsBitField.Flags.ManageGuild, "Manage Server"],
  [PermissionsBitField.Flags.ManageRoles, "Manage Roles"],
  [PermissionsBitField.Flags.ManageChannels, "Manage Channels"],
  [PermissionsBitField.Flags.ManageWebhooks, "Manage Webhooks"],
  [PermissionsBitField.Flags.BanMembers, "Ban Members"],
  [PermissionsBitField.Flags.KickMembers, "Kick Members"]
];

function dangerousAdded(oldPerms, newPerms) {
  const oldBits = new PermissionsBitField(oldPerms);
  const newBits = new PermissionsBitField(newPerms);
  return DANGEROUS.filter(([flag]) => !oldBits.has(flag) && newBits.has(flag)).map(([, name]) => name);
}

function dangerousPermissions(role) {
  return DANGEROUS.filter(([flag]) => role.permissions.has(flag)).map(([, name]) => name);
}

function stripDangerous(bitfield) {
  const safe = new PermissionsBitField(bitfield);
  for (const [flag] of DANGEROUS) safe.remove(flag);
  return safe.bitfield;
}

module.exports = { dangerousAdded, dangerousPermissions, stripDangerous };
