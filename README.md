# Keyloop Service Scheduler

**Scenario A: Unified Service Scheduler · Backend implementation**

A REST service that confirms a vehicle appointment only when a service bay and a
qualified technician are available for the full service duration. Confirmations
are persisted, concurrent writes are serialized, and retries return the original
appointment when the same idempotency key is used.

## Run in five minutes

Requires **Node.js 22.14+ or 24** and npm. No external database or cloud account is
needed. `better-sqlite3` uses a native module; if your platform has no prebuilt
binary, npm needs Python and a C/C++ toolchain to compile it.

```bash
nvm use                     # optional, if nvm is installed
npm ci
npm run seed                # explicit fictional reference data; safe to repeat
npm run build
npm start
```

Open [Swagger UI](http://127.0.0.1:3000/docs/) to inspect and call the API.
The generated [OpenAPI JSON](http://127.0.0.1:3000/docs/json) uses the same
schemas as runtime validation. For source development, use `npm run dev`.

In another terminal:

```bash
npm run demo
npm run check               # strict TypeScript + build + business/API/storage tests
npm run test:coverage       # coverage report in coverage/
```

The demo books tomorrow at 10:00 UTC, reads the saved record, retries the request,
then shows a 409 conflict for another vehicle competing for the only qualified
diagnostic technician. It asserts expected HTTP statuses and exits nonzero on
failure. It writes one real appointment. To repeat at a new time, set
`DEMO_START` to an unused future UTC timestamp; alternatively use a fresh database
path for both the seed command and server. No reset command deletes your data.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/catalog` | Fictional customers, vehicles, services and resource schedules |
| GET | `/availability?dealershipId=...&serviceTypeId=...&startsAt=...` | Advisory bay and technician availability |
| POST | `/appointments` | Atomically confirm a booking; requires `Idempotency-Key` |
| GET | `/appointments/:id` | Retrieve a persisted confirmation |
| GET | `/health` | Process can query its database connection |
| GET | `/metrics` | Request counts and cumulative durations in Prometheus text format |
| GET | `/docs/`, `/docs/json` | Interactive docs and OpenAPI contract |

Example using an automatically generated future timestamp:

```bash
START=$(node -e 'const d=new Date();d.setUTCDate(d.getUTCDate()+2);d.setUTCHours(10,0,0,0);console.log(d.toISOString())')
curl -i http://127.0.0.1:3000/appointments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: walkthrough-booking-1' \
  -d "{\"customerId\":\"customer-1\",\"vehicleId\":\"vehicle-1\",\"dealershipId\":\"dealer-1\",\"serviceTypeId\":\"diagnostics\",\"startsAt\":\"$START\"}"
```

Creation returns `201`, `Location` and the assigned `bayId`, `technicianId`,
`startsAt`, `endsAt`, customer, vehicle and service references. Identical retries
return `200` and `Idempotency-Replayed: true`; changed input with an existing key
returns `409 IDEMPOTENCY_CONFLICT`. UTC timestamps with/without `.000` are equivalent.
The service derives duration and resource assignments; callers cannot override them.

Errors have `{ code, message, requestId }`. Invalid structure/time returns `400`,
unknown references `404`, ownership/opening-hour violations `422`, capacity/vehicle
conflicts `409`, and storage lock timeout `503` with `Retry-After: 1`. Retry a `503`
with bounded exponential backoff, jitter and the **same** idempotency key.

## Design and boundaries

- [System design](docs/system-design.md): architecture, data flow, decisions,
  concurrency, observability, tradeoffs and GenAI design collaboration.
- [Requirements and assumptions](docs/requirements.md): explicit scope and acceptance mapping.
- [Verification](docs/verification.md): executed checks and test inventory.
- [Video walkthrough](docs/video-walkthrough.md): 8-minute English recording guide.
- [GitHub Actions template](docs/github-actions-ci.yml): Node 22/24 checks, ready to
  install at `.github/workflows/ci.yml` with a credential allowed to write workflows.
  It is stored as a template because the publishing token lacks GitHub's `workflow`
  scope; no automatic CI run is claimed. All recorded checks were executed locally.

This is a local assessment service with seeded fictional data. It has **no
authentication or tenant authorization** and binds to loopback by default. The
catalog and appointment APIs are intended for the trusted demo client. Production
deployment requires the controls described in the design document.

## Configuration and storage

| Environment variable | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local-only binding |
| `PORT` | `3000` | Integer 1–65535 |
| `DATABASE_PATH` | `./data/scheduler.db` | Set identically for seed and server |
| `LOG_LEVEL` | `info` | Pino level |
| `BASE_URL` | `http://127.0.0.1:3000` | Demo client target |
| `DEMO_START` | Tomorrow at 10:00 UTC | Demo appointment start |

`.env.example` is a reference; `.env` is not automatically loaded. Export variables
in your shell. All times are UTC. Seeded dealerships operate 08:00–18:00 daily;
technicians have individual shifts and qualifications shown in `/catalog`.

SQLite uses WAL, foreign keys, full synchronous commits and a three-second busy
timeout. Schema version 1 is installed atomically at startup. Unsupported versions
fail startup. Stop the service before manually copying the database, or use SQLite's
backup API; copying only the main file while WAL writes are active is unsafe.
`SIGINT`/`SIGTERM` drain requests and close the database.

## AI Collaboration Narrative

This repository was produced with **Codex as an implementation collaborator**.
The candidate supplied the challenge and requested a complete repository, then
selected private GitHub visibility. Codex proposed Scenario A and the backend
stack, extracted the assessment criteria, documented assumptions, and generated
the implementation, tests and documentation. These technical choices should be
reviewed and owned by the candidate before submission.

The working strategy was to define the invariant first: every confirmation must
reserve both resources for the complete interval. That guided a database transaction
instead of a separate unchecked read-and-insert flow. The next steps were explicit
boundary tests, a restart test against an actual database file, and worker-thread
tests with independent connections released by a shared start barrier. AI-generated
output was checked with the TypeScript compiler, executable HTTP tests, a live
demo and a specialist review pass; actual results are recorded in
[verification](docs/verification.md).

The central review question was whether the tests prove the claim. A collection
of promises against one synchronous connection would not demonstrate independent
writers, so the concurrency test uses separate workers and database connections.
Availability is deliberately documented as advisory; successful confirmation
rechecks inside the write transaction. The code also distinguishes input errors,
business conflicts and retryable storage contention.

Live startup also caught a defect the first 45 in-process tests missed: a Fastify
shutdown hook was registered after the app was ready. It was fixed, a real spawned
server regression test was added, and all 46 tests plus the live demo passed.
The verification record documents that failure and correction explicitly.

This narrative describes the AI-assisted work performed here. It does not claim
that the candidate personally wrote or reviewed every line, ran checks they have
not run, or recorded a video. Before presenting, rerun the demo, trace the booking
transaction, inspect the tests and adapt the walkthrough to your own understanding.

## Submission

The repository contains the system design, backend, client harness, documentation
and tests. **The personal 5–10 minute video remains to be recorded and uploaded.**
Use the walkthrough guide and add its shareable link when replying to the recruiter.
For a private repository, grant the reviewers access before sending the link.
No email has been sent automatically.
