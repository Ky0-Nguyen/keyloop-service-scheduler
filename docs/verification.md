# Verification record

Executed on **2026-09-15**, macOS. These are checks run by the coding agent during
repository preparation, not a claim of separate personal review by the candidate.

## Results

| Check | Result |
| --- | --- |
| Clean `npm ci` on Node 22.14.0 | Passed; lockfile installs reproducibly |
| `npm run check` on Node 22.14.0 | Strict typecheck, compiled build and **46/46 tests passed** |
| `npm run check` on Node 23.7.0 | Passed, including real server lifecycle test |
| `npm run test:coverage` on Node 23.7.0 | **46/46 passed**, 99.26% lines/statements, 96.77% branches, 100% functions |
| Live compiled server + `npm run demo` | Health, availability, 201 create, 200 retrieval, 200 replay and 409 capacity conflict all passed |
| Live `/docs/json` and `/metrics` | OpenAPI returned; bounded route/status metrics reflected requests |
| Live `SIGTERM` | Server exited with code 0 |
| `npm audit --omit=dev` | No reported production vulnerabilities at the time checked |
| Clean-install npm audit | No reported vulnerabilities at the time checked |
| CI template | Prepared for Ubuntu with Node 22/24 in `docs/github-actions-ci.yml`; not activated or executed remotely |

Coverage includes `src` modules and excludes the process entrypoints `server.ts`
and `seed.ts`. Their behavior was verified through the explicit seed command and
spawned-server/live demo checks. Coverage is evidence of exercised lines, not a
proof of correctness or a substitute for scenario assertions.

## Test inventory

- `tests/scheduler.test.ts`: service duration, both resources, qualifications,
  dealership isolation, partial/contained overlap, back-to-back intervals, exhausted
  bays/technicians, shifts and opening hours, fractional minute boundaries, 90-day
  horizon, invalid dates, missing references, vehicle ownership and global vehicle
  overlap, canonical idempotent replay, rollback, database overlap and immutability.
- `tests/api.test.ts`: HTTP creation/retrieval/replay/conflict, malformed input,
  unknown fields, missing key, body size, content type, safe error envelopes,
  availability, catalog, health, docs, low-cardinality metrics and internal error redaction.
- `tests/persistence.test.ts`: actual on-disk reopen, seed preservation, retry after
  restart, independent concurrent booking connections, concurrent identical key,
  writer lock timeout/retry and unsupported schema rejection.
- `tests/server.test.ts`: runs the **compiled server as a separate process**, calls
  HTTP health and verifies clean `SIGTERM` shutdown.

## A defect found during verification

The initial 45 in-process tests passed, but the first live `npm start` failed with
`FST_ERR_INSTANCE_ALREADY_LISTENING`. The server tried registering an `onClose`
hook after the app had completed `ready()`. This exposed a gap between testing
route handlers and testing the actual executable.

The fix moved database closure into the server shutdown function after `app.close()`.
The added process-level regression test now starts the built entrypoint, performs
a real HTTP request and checks shutdown. The full suite and live demo were rerun
successfully after the fix. This is a concrete example for the AI collaboration
walkthrough: passing generated tests did not remove the need to try the real startup.

## Pre-submit review

GitHub created the private repository but rejected the initial push because the
available OAuth token lacks `workflow` scope. The workflow was moved to
`docs/github-actions-ci.yml` as an inactive template before publishing. No remote
CI result is claimed; activation requires copying it into `.github/workflows/ci.yml`
using a credential with the appropriate permission. Node 24 has not been tested
locally; the executed runtime versions are listed above.

The workspace specialist reviewers examined the new source, tests and documentation
in the requested order: Solution Architect, Principal Engineer, QA, Karpathy
Discipline. No additional actionable business/API issues were reported. QA and the
final discipline verdict were conditional on resolving and verifying the startup
issue above; the successful 46-test rerun and live demo satisfy that condition.

**Verdict: GO for the documented local assessment scope.**

Not claimed: production readiness, load benchmarks, crash/power-loss fault injection,
distributed hosting, real identity/tenant security, real-world holiday/DST calendars,
or a completed personal video. The user must record/upload the video and grant
reviewer access to the private repository before submitting.
