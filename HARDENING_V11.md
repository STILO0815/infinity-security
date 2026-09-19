# Infinity Security v11 Aegis — Hardening Report

## Core additions
- Cross-vector audit-log threat correlation.
- Four threat levels with cooldown-aware escalation.
- Tuned Relaxed/Balanced/Strict/Maximum presets.
- Runtime permission and role-hierarchy Health Guard.
- SHA-256-sealed recovery backups and restore refusal on digest mismatch.
- Live `/threats` and `/health` administration commands.

## Correlation regression examples
- One channel delete: score 6 → below escalation.
- Channel delete + role update + webhook: score 13 → ACTION.
- Bot add + role delete + AutoMod delete: score 21 → CRITICAL.

## Safety invariants retained
- No automatic `.kick()` or `.ban()` calls.
- Automatic member sanction remains timeout-only.
- Existing longer timeout is never shortened.
- Action deduplication reduces double punishment from overlapping detectors.
- Trusted users/roles are excluded from automatic hostile correlation.
- Maximum preset is the only preset that enables automatic Emergency Mode on a critical correlated score by default.

## Validation
`npm run audit` passes v10 regression tests plus v11 Aegis hardening tests.
