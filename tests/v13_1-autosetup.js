const assert = require('assert');
const { defaultGuildConfig } = require('../src/config');
const { applyAutoSetupProfile } = require('../src/security/autoSetup');

const cfg = defaultGuildConfig();
cfg.antiSpam.enabled = false;
cfg.antiNuke.enabled = false;
cfg.voiceDomain.enabled = false;
cfg.permissionGuard.enabled = false;
cfg.verification.enabled = false;

const result = applyAutoSetupProfile(cfg, {
  preset: 'strict',
  mode: 'enforce',
  verification: true
});

assert.equal(result.preset, 'strict');
assert.equal(result.mode, 'enforce');
assert.equal(result.verification, true);
assert.equal(cfg.antiSpam.enabled, true);
assert.equal(cfg.antiNuke.enabled, true);
assert.equal(cfg.voiceDomain.enabled, true);
assert.equal(cfg.permissionGuard.enabled, true);
assert.equal(cfg.threatCorrelation.enabled, true);
assert.equal(cfg.selfProtection.enabled, true);
assert.equal(cfg.backups.autoEnabled, true);
assert.equal(cfg.botInteractions.enabled, true);
assert.equal(cfg.aura.intensity, 'overdrive');
assert.equal(cfg.antiSpam.maxMessages, 5); // strict preset proof

const preserve = defaultGuildConfig();
preserve.verification.enabled = true;
applyAutoSetupProfile(preserve, { preset: 'balanced', mode: 'alert' });
assert.equal(preserve.verification.enabled, true, 'omitted verification option must preserve existing setting');
assert.equal(preserve.mode, 'alert');

console.log('v13.1 Auto Setup tests: PASS');
