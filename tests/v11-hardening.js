const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  recordThreatSignal,
  getThreatSnapshot,
  clearThreat
} = require('../src/security/threatEngine');
const { applySecurityPreset } = require('../src/security/presets');

function freshCfg() {
  return {
    windowMs: 20000,
    highScore: 8,
    actionScore: 12,
    criticalScore: 18,
    escalationCooldownMs: 15000,
    autoEmergencyOnCritical: false,
    weights: {}
  };
}

function presetCfg() {
  return {
    antiSpam: {}, antiRaid: {}, antiNuke: {}, linkScanner: {}, aiGuard: {},
    threatCorrelation: freshCfg()
  };
}

// One ordinary destructive action should be visible, but below escalation.
{
  const cfg = freshCfg();
  clearThreat('g-single', 'u');
  const x = recordThreatSignal('g-single', 'u', 'channel_delete', cfg);
  assert.equal(x.score, 6);
  assert.equal(x.level, 'normal');
  assert.equal(x.shouldAct, false);
}

// Mixed attack correlation: delete channel + dangerous role update + webhook.
{
  const cfg = freshCfg();
  clearThreat('g-mixed', 'attacker');
  recordThreatSignal('g-mixed', 'attacker', 'channel_delete', cfg); // 6
  recordThreatSignal('g-mixed', 'attacker', 'role_update', cfg);    // +3
  recordThreatSignal('g-mixed', 'attacker', 'webhook', cfg);        // +4
  const snap = getThreatSnapshot('g-mixed', 'attacker', cfg);
  assert.equal(snap.score, 13);
  assert.equal(snap.level, 'action');
  assert.ok(snap.types.includes('channel_delete'));
  assert.ok(snap.types.includes('role_update'));
  assert.ok(snap.types.includes('webhook'));
}

// Critical mixed compromise: bot add + role delete + AutoMod delete.
{
  const cfg = freshCfg();
  clearThreat('g-critical', 'attacker');
  recordThreatSignal('g-critical', 'attacker', 'bot_add', cfg);       // 7
  recordThreatSignal('g-critical', 'attacker', 'role_delete', cfg);   // +6
  recordThreatSignal('g-critical', 'attacker', 'automod_delete', cfg);// +8
  const snap = getThreatSnapshot('g-critical', 'attacker', cfg);
  assert.equal(snap.score, 21);
  assert.equal(snap.level, 'critical');
}

// Presets should genuinely tune thresholds.
{
  const balanced = presetCfg();
  assert.equal(applySecurityPreset(balanced, 'balanced'), true);
  assert.equal(balanced.threatCorrelation.actionScore, 12);
  assert.equal(balanced.threatCorrelation.autoEmergencyOnCritical, false);

  const maximum = presetCfg();
  assert.equal(applySecurityPreset(maximum, 'maximum'), true);
  assert.ok(maximum.threatCorrelation.actionScore < balanced.threatCorrelation.actionScore);
  assert.ok(maximum.antiRaid.maxJoins < balanced.antiRaid.maxJoins);
  assert.equal(maximum.threatCorrelation.autoEmergencyOnCritical, true);
}

// Static hardening invariants: integrity checks and timeout-only enforcement stay in source.
{
  const backups = fs.readFileSync(path.join(__dirname, '../src/security/backups.js'), 'utf8');
  assert.ok(backups.includes('sha256'));
  assert.ok(backups.includes('verifyBackup'));
  assert.ok(backups.includes('integrityError'));

  const srcDir = path.join(__dirname, '../src');
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  }
  walk(srcDir);
  const all = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.equal(/\.(kick|ban)\s*\(/.test(all), false, 'automatic kick/ban method found');
  assert.ok(all.includes('guildAuditLogEntryCreate'));
  assert.ok(all.includes('Aegis correlated threat'));
}

console.log('PASS: single action stays below correlation threshold');
console.log('PASS: mixed audit-log attack correlation');
console.log('PASS: critical cross-vector compromise scoring');
console.log('PASS: security presets tune Aegis thresholds');
console.log('PASS: backup integrity + timeout-only static invariants');
