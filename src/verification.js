const { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { commit } = require("../config");

const challenges = new Map();

function key(guildId, userId) { return `${guildId}:${userId}`; }
function makeCode() { return String(Math.floor(10000 + Math.random() * 90000)); }

async function ensureVerificationSetup(guild, cfg, botUserId) {
  let role = cfg.verification.unverifiedRoleId ? guild.roles.cache.get(cfg.verification.unverifiedRoleId) : null;
  if (!role) role = guild.roles.cache.find(r => r.name === "∞ Unverified");
  if (!role) role = await guild.roles.create({ name: "∞ Unverified", reason: "Infinity Security verification" }).catch(() => null);
  if (role) cfg.verification.unverifiedRoleId = role.id;

  let channel = cfg.verification.channelId ? guild.channels.cache.get(cfg.verification.channelId) : null;
  if (!channel?.isTextBased()) channel = guild.channels.cache.find(c => c.name === "verify" && c.isTextBased());
  if (!channel) {
    channel = await guild.channels.create({
      name: "verify",
      type: ChannelType.GuildText,
      topic: "Infinity Security human verification",
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
        ...(botUserId ? [{ id: botUserId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ReadMessageHistory] }] : [])
      ]
    }).catch(() => null);
  }
  if (channel) cfg.verification.channelId = channel.id;
  commit();

  if (role && channel) await postVerificationPanel(channel);
  return { role, channel };
}

async function postVerificationPanel(channel) {
  const existing = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const already = existing?.find(m => m.author?.bot && m.components?.some(row => row.components?.some(c => c.customId === "verify_start")));
  if (already) return already;

  return channel.send({
    embeds: [new EmbedBuilder()
      .setTitle("👁️ Infinity Verification")
      .setDescription("Press **Verify** and solve the short code challenge. No external website, no password, no weird links.\n\n*Six Eyes just want to know you're human.*")
      .setColor(0x7dd3fc)
      .setFooter({ text: "Infinity Security • Human check" })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("verify_start").setLabel("Verify").setEmoji("✅").setStyle(ButtonStyle.Success)
    )]
  }).catch(() => null);
}

async function applyRestrictionToChannel(channel, cfg) {
  const roleId = cfg.verification.unverifiedRoleId;
  if (!cfg.verification.enabled || !roleId || channel.id === cfg.verification.channelId) return false;
  try {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: false, AddReactions: false });
      return true;
    }
    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
      await channel.permissionOverwrites.edit(roleId, { Connect: false });
      return true;
    }
  } catch {}
  return false;
}

async function applyRestrictionsGuild(guild, cfg) {
  let count = 0;
  for (const channel of guild.channels.cache.values()) if (await applyRestrictionToChannel(channel, cfg)) count++;
  return count;
}

async function markNewMemberUnverified(member, cfg) {
  if (!cfg.verification.enabled || member.user.bot || !cfg.verification.unverifiedRoleId) return false;
  return member.roles.add(cfg.verification.unverifiedRoleId, "Infinity Security verification pending").then(() => true).catch(() => false);
}

function buildChallengeModal(guildId, userId, minutes = 10) {
  const code = makeCode();
  challenges.set(key(guildId, userId), { code, expiresAt: Date.now() + minutes * 60000 });
  const input = new TextInputBuilder().setCustomId("verify_code").setLabel(`Type this code: ${code}`).setStyle(TextInputStyle.Short).setRequired(true).setMinLength(5).setMaxLength(5);
  return new ModalBuilder().setCustomId(`verify_submit_${guildId}_${userId}`).setTitle("Infinity Verification").addComponents(new ActionRowBuilder().addComponents(input));
}

async function completeChallenge(interaction, cfg) {
  const item = challenges.get(key(interaction.guildId, interaction.user.id));
  challenges.delete(key(interaction.guildId, interaction.user.id));
  const typed = interaction.fields.getTextInputValue("verify_code").trim();
  if (!item || item.expiresAt < Date.now() || typed !== item.code) return { ok: false, reason: "wrong_or_expired" };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return { ok: false, reason: "member_missing" };
  if (cfg.verification.unverifiedRoleId) await member.roles.remove(cfg.verification.unverifiedRoleId, "Infinity Security verification passed").catch(() => {});
  return { ok: true, member };
}

module.exports = { ensureVerificationSetup, applyRestrictionsGuild, applyRestrictionToChannel, markNewMemberUnverified, buildChallengeModal, completeChallenge };
