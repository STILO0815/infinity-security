const assert = require("assert");
const {
  mergeMediatorState,
  juryConsensus,
  defaultMediatorState
} = require("../src/security/mediatorAI");

const users = ["100", "200"];

// Evidence/claim ledger should merge without duplicating identical findings.
let state = defaultMediatorState();
state = mergeMediatorState(state, {
  phase: "evidence",
  summary: "A says a trade was not completed.",
  evidenceRequest: "Send the original trade message.",
  claims: [
    { claimantUserId: "100", statement: "User B promised item X", type: "allegation", importance: 3, status: "unsupported" }
  ],
  evidenceFindings: [],
  contradictions: [],
  agreements: ["Both agree a trade was discussed"],
  openQuestions: ["Was item X actually promised?"]
}, users);

state = mergeMediatorState(state, {
  phase: "comparison",
  summary: "A verified Discord message supports that item X was discussed.",
  evidenceRequest: "",
  claims: [
    { claimantUserId: "100", statement: "User B promised item X", type: "allegation", importance: 3, status: "partially_supported" }
  ],
  evidenceFindings: [
    { sourceType: "discord_message", sourceRef: "discord:1/2/3", supportsUserId: "100", finding: "Original message mentions item X", reliability: "verified_discord", strength: 0.9 }
  ],
  contradictions: [],
  agreements: ["Both agree a trade was discussed"],
  openQuestions: ["Was the trade completed?"]
}, users);

assert.equal(state.phase, "comparison");
assert.equal(state.evidenceFindings.length, 1);
assert.ok(state.claims.length >= 1);
assert.deepEqual(state.openQuestions, ["Was the trade completed?"]);

// 2/3 agreement with no strong dissent can produce a conduct finding.
let jury = juryConsensus([
  { role: "Evidence Reviewer", violationUserId: "200", violationType: "scam", confidence: 0.96, reason: "Verified messages support deception", summary: "Evidence summary", missingEvidence: [] },
  { role: "Conduct Reviewer", violationUserId: "200", violationType: "scam", confidence: 0.95, reason: "Conduct meets scam rule", summary: "Conduct summary", missingEvidence: [] },
  { role: "False-Positive Reviewer", violationUserId: null, violationType: null, confidence: 0.70, reason: "Some uncertainty remains", summary: "FP review", missingEvidence: ["Payment receipt unavailable"] }
], users);
assert.equal(jury.accepted, true);
assert.equal(jury.violationUserId, "200");
assert.equal(jury.violationType, "scam");
assert.equal(jury.consensus, "2/3");

// Strong skeptical dissent blocks automatic action.
jury = juryConsensus([
  { role: "Evidence Reviewer", violationUserId: "200", violationType: "harassment", confidence: 0.96, reason: "A", summary: "A", missingEvidence: [] },
  { role: "Conduct Reviewer", violationUserId: "200", violationType: "harassment", confidence: 0.95, reason: "B", summary: "B", missingEvidence: [] },
  { role: "False-Positive Reviewer", violationUserId: null, violationType: null, confidence: 0.95, reason: "Context is incomplete", summary: "C", missingEvidence: ["Full context"] }
], users);
assert.equal(jury.accepted, false);
assert.equal(jury.violationUserId, null);
assert.equal(jury.strongDissent, true);

// Split jury must not punish anyone.
jury = juryConsensus([
  { role: "Evidence Reviewer", violationUserId: "100", violationType: "harassment", confidence: 0.96, reason: "A", summary: "A", missingEvidence: [] },
  { role: "Conduct Reviewer", violationUserId: "200", violationType: "harassment", confidence: 0.96, reason: "B", summary: "B", missingEvidence: [] },
  { role: "False-Positive Reviewer", violationUserId: null, violationType: null, confidence: 0.70, reason: "C", summary: "C", missingEvidence: [] }
], users);
assert.equal(jury.accepted, false);

console.log("v13 mediation AI tests: PASS");
