# Performance Baseline (Phase 1)

Date: 2026-03-05

## Build baseline
- Command: `npm run build`
- Main bundle (before phase 2 target): `dist/assets/index-BhYS7jz6.js`
- Size: `1083.74 kB`
- Gzip: `345.29 kB`

## Runtime baseline (manual)
- Message list rendering: full render of all messages.
- Execution strategy: full parallel `Promise.all` for run plans and per-image generation.
- Storage writes: immediate localStorage writes on each conversation update.

## Target
- Main bundle `< 750 kB`
- Input latency p95 `< 100ms` in large conversation
- No throughput regression for 4 side x 4 images scenario
