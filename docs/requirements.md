# Scope and acceptance plan

Chosen scenario: **A, Unified Service Scheduler**. Implement the backend; use a
scripted HTTP client and Swagger UI as the client stub. Source: the supplied
Keyloop Technical Assessment, version 1.0. The original PDF is not redistributed.

## Product requirement

A service advisor can request an appointment for a customer, their vehicle, a
service type, dealership and desired start time. Confirmation requires a free
bay and a qualified technician for the **entire** service duration. The confirmed
record must survive restart and link all participants.

## Implementation slices

1. Model reference data and persisted appointments with database constraints.
2. Offer advisory availability; atomically recheck resources during confirmation.
3. Expose validated REST endpoints, errors, retry semantics and API documentation.
4. Verify business boundaries, independent concurrent writers and persistence.
5. Document architecture, actual AI collaboration and a rehearsable video demo.

## Acceptance mapping

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Vehicle, service, dealership and desired time | `POST /appointments` | HTTP success, invalid references and ownership tests |
| Both resources available throughout duration | Scheduler + immediate transaction | Containment, partial overlap, shift and opening boundaries |
| Qualified technician at selected dealership | Qualification lookup + composite foreign keys | Wrong skill, other dealer and exhausted resource tests |
| Persistent confirmed record | SQLite appointment row | Reopen a disk database and retrieve via HTTP |
| No double booking under contention | Transaction + overlap trigger | Independent worker connections, competing requests |
| Safe client retry | Persistent idempotency key and canonical request | Replay, changed payload, concurrent replay |
| Client-side stub | `npm run demo`, `/docs` | Live HTTP demonstration |

## Deliberate assumptions

- Seeded fictional customers, vehicles, dealerships, bays, skills and services;
  managing reference data is outside this service layer.
- Trusted local evaluation client. No authentication/authorization is implemented;
  checking customer/vehicle ownership is a data integrity check, not authentication.
- UTC-only timestamps with seconds, optional three-digit milliseconds, ending in
  `Z`. Bookings must start in the future and no more than 90 days ahead.
- Fixed service durations; no setup buffers. Half-open intervals `[start, end)`
  permit one service to start exactly when another ends.
- Every day uses the seeded UTC opening hours and technician shifts. No holidays,
  breaks, leave, daylight-saving schedules or bay equipment requirements.
- One bay and one qualified technician stay assigned throughout a service.
- A vehicle cannot have overlapping appointments, even at different dealerships.
- Availability is a snapshot, not a reservation. Confirmed appointments are immutable;
  cancellation, rescheduling, reminders, payments and a complete UI are out of scope.
- Idempotency keys are global to this local service and retained with appointments.
  Production keys must be scoped to authenticated callers/tenants.
