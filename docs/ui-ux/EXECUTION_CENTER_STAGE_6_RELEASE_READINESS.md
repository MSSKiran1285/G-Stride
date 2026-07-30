# Execution Center — Stage 6 release readiness

## Purpose

The approved Execution Center backlog ends at Wave 3. Stage 6 is therefore a
release-hardening stage rather than a new feature wave. It closes safe,
isolated gaps in security, persistence, accessibility, migration coverage, and
release verification.

## Hardening delivered

### Start and target safety

- The execution API rejects Start unless it receives a valid server-issued
  preflight token and approved plan hash.
- Start rechecks the current SAP credential-profile context. A changed URL,
  identity label, configuration source, or availability invalidates preflight.
- Start requests with malformed scope still return a field/scope validation
  error before the preflight requirement, preserving useful API behavior.
- Existing live-approved API tests now use the preflight → acknowledge → Start
  contract.

### Authentication and response security

- Authentication remains enforced for all `/api` routes except the explicit
  authentication bootstrap endpoints.
- API responses use `Cache-Control: no-store`.
- Server fingerprinting through `X-Powered-By` is disabled.
- `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` headers
  are set centrally.

### Secret isolation and event persistence

- Known runtime username/password values are redacted from captured child
  process output.
- Generic bearer tokens, password/token/secret assignments, and URL user-info
  are also redacted.
- Reruns receive the same runtime-only redaction context.
- The CLI writes append-only structural orchestration events to
  `execution-events.jsonl` in sequence with timestamps.
- Credentials remain excluded from plans, snapshots, progress, event records,
  evidence, API responses, and metrics.

### Retention policy

`GET /api/execution-retention` exposes the current policy:

- snapshots and event records remain with their Studio run;
- canonical evidence remains in the audit archive;
- automatic deletion is disabled;
- records are retained until the workspace owner explicitly deletes them.

No automatic purge was introduced because a time-based retention period has
not been approved by the workspace owner.

### Accessibility and responsive behavior

- Compact navigation buttons retain accessible names when their visible labels
  are hidden.
- Execution status uses live status and busy semantics.
- The Execution Center is regression-tested at 320 CSS pixels without
  horizontal page overflow.
- Keyboard focus reaches an interactive control.
- Reduced-motion behavior is retained.
- Windows forced-colour styles preserve borders and progress indication.

### Migration and release regression

- API fixtures were aligned with the current retained data and Process Suite
  assets.
- Live execution tests were migrated to the mandatory preflight contract.
- Security tests cover mandatory preflight, no-store responses, security
  headers, target freshness, retention policy, and credential redaction.

## Release gates requiring explicit external approval

The isolated Stage 6 implementation does not authorize these actions:

1. Live SAP execution and reconciliation for the approved positive, negative,
   cancellation, and failed-scope rerun scenarios.
2. Manual NVDA/Chromium verification by an assistive-technology user.
3. Workspace-owner approval of a finite snapshot/evidence retention period, if
   automatic deletion is desired.
4. Production deployment, commit, or push.

These are sign-off gates, not hidden implementation claims. The local release
candidate remains usable without running them.

## Local release candidate

`http://127.0.0.1:4510/execute/new`

