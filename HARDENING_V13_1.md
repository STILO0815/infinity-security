# Infinity Security v13.1 — Instant Auto-Setup

## New command
`/auto-setup` deploys and validates the complete Infinity stack in one operation.

## Safety
- Default preset: Balanced
- Default mode: Alert
- Verification is never silently forced on
- Existing timeout-only enforcement policy remains unchanged
- Missing Discord permissions are reported by Health Guard instead of being hidden

## Deployment checks
Auto-Setup runs infrastructure repair, channel classification, Voice Domain creation, Protected Member invite preparation, backup creation, Self-Guard analysis, Health Guard and Security Score calculation.
