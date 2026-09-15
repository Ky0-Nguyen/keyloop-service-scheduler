# Video walkthrough guide (target: 8 minutes)

This is a recording guide, not a completed video or a claim of personal experience.
Use your own voice, verify the implementation first and adjust the narrative to
what you actually did. Do not read unfamiliar technical claims verbatim.

## Before recording

1. Run `npm ci` and `npm run check`.
2. Choose a new database path (for example `./data/video-take-1.db`) and run:

   ```bash
   DATABASE_PATH=./data/video-take-1.db npm run seed
   DATABASE_PATH=./data/video-take-1.db npm start
   ```

   `npm run check` already builds the server. Keep the server terminal open.
3. Open README, system design, `src/scheduler.ts`, `tests/persistence.test.ts` and
   [Swagger UI](http://127.0.0.1:3000/docs/). Use a readable font size.
4. Prepare a second terminal for `npm run demo`. A fresh take needs another database
   path or a different `DEMO_START`; the demo intentionally persists its booking.

## Suggested timeline and talking points

### 0:00–0:40 — Introduction

“Hi, I'm Nguyen. This is my submission for Scenario A, the Unified Service
Scheduler. The service confirms an appointment only if both a bay and a qualified
technician are available for its full duration. I implemented the backend and used
a scripted HTTP client and Swagger as the client layer.”

### 0:40–1:45 — System design

Show the architecture diagram. Explain the REST boundary, scheduling logic and
SQLite database. State why a single transactional service fits this scope and why
SQLite lowers setup effort. Identify the one-writer limitation and why production
scaling would require revisiting storage and concurrency.

Call out assumptions: UTC, fixed durations, daily opening hours, immutable confirmed
appointments and a trusted local client without authentication.

### 1:45–3:10 — Implementation highlights

Open `src/scheduler.ts`:

- Show `transaction(...).immediate()` and explain why the lock comes before the read.
- Walk through key replay, ownership, vehicle conflict, resource search and insert.
- Explain `[start, end)` using a 10:00–12:00 service followed by a 12:00 appointment.
- Show that duration and technician assignment come from the service, not the client.
- Mention the database overlap trigger as an additional guard.

### 3:10–4:40 — Live demonstration

Run `npm run demo` and pause on each result:

1. Availability: both resources can cover 10:00–12:00 tomorrow.
2. `201`: confirmation contains customer, vehicle, bay and qualified technician IDs.
3. `GET`: the stored appointment is retrievable.
4. `200`: retry returns the same ID without creating another appointment.
5. `409`: another vehicle cannot consume the same diagnostic technician.

Optionally copy the appointment ID, restart the server using the same database path,
and retrieve it in Swagger. Keep this within the recording time budget.

### 4:40–6:15 — AI collaboration story (about 95 seconds)

Use accurate statements about the work:

- Codex proposed the scenario/stack, drafted the design and generated substantial
  implementation, tests and docs in response to the repository request.
- Explain the invariant used to evaluate the generated code: no overlapping
  reservation of either resource across the complete service duration.
- Show one test you have personally examined. The strongest example is the worker
  test: separate connections synchronize at a barrier, then only one competing
  booking succeeds. A pair of promises on one synchronous connection is weaker evidence.
- Explain what you personally reviewed or changed after generation. Only claim
  checks you actually performed. Refer to the recorded automated checks separately.
- Discuss one tradeoff you can defend and one part you would improve next.
- Use the actual startup defect in `verification.md` as a debugging example: the
  initial API tests passed, live startup failed, and a process-level regression
  test was added after fixing the lifecycle hook ordering.

### 6:15–7:15 — Validation and operational thinking

Show `npm run check` results and the test categories: full interval overlap,
qualification, shift boundary, ownership, idempotency, restart and storage contention.
Show one structured log and `/metrics`. Distinguish implemented request correlation
and counters from the proposed tracing/histogram strategy.

### 7:15–8:00 — Learning and next steps

Explain one actual learning or difficulty from reviewing/running the solution.
Possible discussion topics: advisory reads versus atomic confirmation; stronger
concurrency evidence; why low setup effort has a throughput cost.

Close with production priorities: authentication and dealer authorization, real
calendars, PostgreSQL concurrency constraints and notification outbox if required.

## Before sending

- Record 5–10 minutes; check audio, readable code and that both links work.
- Upload the recording using your chosen service and test reviewer access.
- Grant the intended reviewers access to the private GitHub repository.
- Include the repository and video links in your reply. This repo does not send mail.
