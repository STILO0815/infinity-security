function applySecurityPreset(cfg, preset) {
  const name=String(preset||'').toLowerCase();
  if (name==='relaxed') {
    cfg.antiSpam.maxMessages=9; cfg.antiSpam.windowMs=7000; cfg.antiRaid.maxJoins=12; cfg.antiRaid.windowMs=10000;
    cfg.antiNuke.destructiveThreshold=4; cfg.linkScanner.actionRisk=9; cfg.aiGuard.actionConfidence=0.96;
    cfg.threatCorrelation.highScore=10; cfg.threatCorrelation.actionScore=15; cfg.threatCorrelation.criticalScore=22; cfg.threatCorrelation.autoEmergencyOnCritical=false;
  } else if (name==='strict') {
    cfg.antiSpam.maxMessages=5; cfg.antiSpam.windowMs=7000; cfg.antiRaid.maxJoins=7; cfg.antiRaid.windowMs=10000;
    cfg.antiNuke.destructiveThreshold=3; cfg.linkScanner.actionRisk=7; cfg.aiGuard.actionConfidence=0.92;
    cfg.threatCorrelation.highScore=7; cfg.threatCorrelation.actionScore=11; cfg.threatCorrelation.criticalScore=17; cfg.threatCorrelation.autoEmergencyOnCritical=false;
  } else if (name==='maximum') {
    cfg.antiSpam.maxMessages=4; cfg.antiSpam.windowMs=6500; cfg.antiRaid.maxJoins=5; cfg.antiRaid.windowMs=9000;
    cfg.antiNuke.destructiveThreshold=2; cfg.linkScanner.actionRisk=6; cfg.aiGuard.actionConfidence=0.90;
    cfg.threatCorrelation.highScore=6; cfg.threatCorrelation.actionScore=9; cfg.threatCorrelation.criticalScore=14; cfg.threatCorrelation.autoEmergencyOnCritical=true;
  } else if (name==='balanced') {
    cfg.antiSpam.maxMessages=6; cfg.antiSpam.windowMs=7000; cfg.antiRaid.maxJoins=8; cfg.antiRaid.windowMs=10000;
    cfg.antiNuke.destructiveThreshold=3; cfg.linkScanner.actionRisk=7; cfg.aiGuard.actionConfidence=0.93;
    cfg.threatCorrelation.highScore=8; cfg.threatCorrelation.actionScore=12; cfg.threatCorrelation.criticalScore=18; cfg.threatCorrelation.autoEmergencyOnCritical=false;
  } else return false;
  cfg.securityPreset=name; return true;
}
module.exports={applySecurityPreset};
