const { applySecurityPreset } = require('./presets');

function applyAutoSetupProfile(cfg, options = {}) {
  const preset = String(options.preset || 'balanced').toLowerCase();
  const mode = String(options.mode || 'alert').toLowerCase();
  const verification = options.verification;

  if (!applySecurityPreset(cfg, preset)) {
    throw new Error(`Unknown security preset: ${preset}`);
  }

  cfg.enabled = true;
  cfg.mode = mode === 'enforce' ? 'enforce' : 'alert';

  // Core protection stack.
  cfg.antiSpam.enabled = true;
  cfg.antiRaid.enabled = true;
  cfg.antiNuke.enabled = true;
  cfg.aiGuard.mode = 'smart';
  cfg.mediation.enabled = true;
  cfg.appeals.enabled = true;
  cfg.linkScanner.enabled = true;
  cfg.messageLogs.enabled = true;
  cfg.messageLogs.ghostPingEnabled = true;
  cfg.voiceSecurity.enabled = true;
  cfg.voiceDomain.enabled = true;
  cfg.voiceDomain.autoCreateHub = true;
  cfg.permissionGuard.enabled = true;
  cfg.permissionGuard.revertDangerousChanges = true;
  cfg.threatCorrelation.enabled = true;
  cfg.healthGuard.enabled = true;
  cfg.selfProtection.enabled = true;
  cfg.protectedMembers.enabled = true;
  cfg.backups.enabled = true;
  cfg.backups.autoEnabled = true;
  cfg.reports.enabled = true;
  cfg.botInteractions.enabled = true;
  cfg.channelSafety.autoScan = true;
  cfg.startup.logOnlineMessage = true;

  // Keep the personality consistent with the premium build.
  cfg.aura.publicReplies = true;
  cfg.aura.offenderDms = true;
  cfg.aura.intensity = 'overdrive';

  // Verification is deliberately opt-in because enabling it changes access
  // across the entire server. If the option is omitted, preserve the current setting.
  if (typeof verification === 'boolean') {
    cfg.verification.enabled = verification;
  }

  return {
    preset: cfg.securityPreset,
    mode: cfg.mode,
    verification: cfg.verification.enabled,
    enabledModules: [
      'antiSpam', 'antiRaid', 'antiNuke', 'aiGuard', 'mediation', 'appeals',
      'linkScanner', 'messageLogs', 'voiceSecurity', 'voiceDomain',
      'permissionGuard', 'threatCorrelation', 'healthGuard', 'selfProtection',
      'protectedMembers', 'backups', 'reports', 'botInteractions', 'channelSafety'
    ]
  };
}

module.exports = { applyAutoSetupProfile };
