# Changelog

## 0.3.0 — 2026-09-23

- Batch previews classify new, completed, retryable, uncertain, conflicting and invalid requests before execution. Detect identical requests within the input and under other journal keys, including older single-item keys.
- Read-only recovery guides show unresolved operations, owner availability and next steps without contacting Korea Post or unlocking records.
- Read-only SQLite inspection does not create missing files or modify existing journal data. History and operation commands use this mode too.
- Successful replay no longer waits between rows; real site requests retain their configured interval, including across intervening cached rows.
- TypeScript inspection/recovery interfaces, preview and Windows guides, updated CLI/API/recovery/migration documentation.
- Extend CI to Windows and macOS alongside Linux, and fix file URL handling for Windows paths.

Live Korea Post account/payment validation remains pending. Not published to the npm registry.

## 0.2.0 — 2026-09-19

- Sequential CSV/JSON batch reservations, full cancellations and fresh status lookups (up to 1,000 rows). Each parcel is a separate reservation.
- Korean/English CSV headers, common sender/parcel defaults and grouped per-row validation.
- Stable batch/item keys, successful-item replay, explicit safe failed-item retry and cooperative interruption between items. Unknown outcomes never auto-retry.
- Progress summaries, atomic JSON/CSV reports, formula-safe CSV exports and account-scoped history.
- Project initializer, local-only environment diagnostics, explicit env/config loading and command help.
- Shared batch browser process with isolated per-item contexts.
- Task-oriented documentation, CLI/API references, recovery and migration guides, runnable synthetic examples.
- Regression tests for partial failure, interruption/resume, report-write failure, imports, CLI onboarding and browser reuse.

Live validation against Korea Post is still pending. Existing unit/fixture tests do not establish current live-site compatibility. Not published to the npm registry.

## 0.1.0 — 2026-09-19

Initial experimental public version.

- Independent JavaScript SDK, TypeScript declarations and CLI.
- Prepaid pickup reservation, reservation lookup, full cancellation and form options.
- Durable operation keys, request fingerprints, account locking, conservative unknown-outcome handling and manual recovery audit trail.
- Minimal public errors, no persisted credentials/contacts, strict date and phone validation.
- Offline input validation, synthetic Chromium integration tests, CI and secret scanning.

Live Korea Post account/payment validation of the extracted public version is pending. Not published to the npm registry.
