# Demo data and recording guide

This guide describes the fictional data created by `npm run seed`, the expected
booking results, and how to prepare a repeatable video demonstration.
The source of the seed data is [`src/fixtures.ts`](../src/fixtures.ts).

## Quick start with the default database

From the repository directory, use Node 22 and run:

```bash
nvm use 22
npm ci
npm run seed
npm run build
npm start
```

In a second terminal, using Node 22:

```bash
curl http://127.0.0.1:3000/catalog
npm run demo
```

Open [Swagger UI](http://127.0.0.1:3000/docs/) for manual API calls.
`GET /catalog` lists all reference data in the database currently used by the server.

The server does not seed automatically. `npm run seed` inserts missing reference
rows and preserves existing rows and appointments. It **does not reset bookings**
or restore reference rows that someone has modified directly.

## Reference data

All times below are **UTC**, every day. The API's catalog stores hours as minutes
after midnight: for example, `480` means 08:00. A timestamp ending in `Z` is UTC;
10:00 UTC corresponds to 17:00 in Vietnam.

### Customers and their vehicles

| Customer ID | Name | Owned vehicle IDs |
| --- | --- | --- |
| `customer-1` | Alex Demo | `vehicle-1`, `vehicle-3` |
| `customer-2` | Sam Demo | `vehicle-2` |

### Dealerships and service bays

| Dealership ID | Name | Opening hours | Bay IDs |
| --- | --- | --- | --- |
| `dealer-1` | Central Motors | 08:00–18:00 | `bay-1`, `bay-2` |
| `dealer-2` | Riverside Motors | 08:00–18:00 | `bay-3` |

### Services

| Service type ID | Service | Duration |
| --- | --- | --- |
| `oil-change` | Oil change | 60 minutes |
| `diagnostics` | Engine diagnostics | 120 minutes |
| `ev-check` | EV battery inspection | 90 minutes |

### Technicians and qualifications

| Technician ID | Name | Dealership | Shift | Qualified service IDs |
| --- | --- | --- | --- | --- |
| `tech-1` | Taylor Demo | `dealer-1` | 08:00–18:00 | `oil-change`, `diagnostics` |
| `tech-2` | Jordan Demo | `dealer-1` | 09:00–17:00 | `oil-change` |
| `tech-3` | Casey Demo | `dealer-2` | 08:00–18:00 | `oil-change`, `ev-check` |

Central Motors has two bays, but only **one** technician qualified for diagnostics.
This is intentional: the demo proves that a free bay alone cannot confirm a booking.

## What the automated demo does

`npm run demo` uses `customer-1`, `vehicle-1`, `dealer-1` and `diagnostics`, starting
tomorrow at 10:00 UTC. The server derives the 12:00 end time.

| Step | Request | Expected result on a fresh seeded database |
| --- | --- | --- |
| 1 | `GET /health` | `200`, status `ok` |
| 2 | `GET /availability` | `200`, both bays and `tech-1` available |
| 3 | `POST /appointments` | `201`, assigns `bay-1` and `tech-1` |
| 4 | `GET /appointments/:id` | `200`, retrieves the saved record |
| 5 | Repeat the original request with the same key | `200`, same appointment ID |
| 6 | Same time/service for `customer-2` and `vehicle-2`, with a new key | `409 NO_CAPACITY` |

The client asserts statuses and the replayed ID. On success, it prints `Demo passed`.
It writes one appointment; subsequent default demo runs on the same database may
conflict because the first appointment is still present.

## Prepare a fresh recording without deleting existing data

Use a separate database and port. These commands are for macOS/Linux shells.
If port 3001 is occupied, select a free port and update the client URLs accordingly.

Terminal 1, from the repository directory:

```bash
nvm use 22
npm run build
RECORDING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/keyloop-video.XXXXXX")
export DATABASE_PATH="$RECORDING_DIR/scheduler.db"
npm run seed
PORT=3001 npm start
```

Terminal 2, from the same directory:

```bash
nvm use 22
BASE_URL=http://127.0.0.1:3001 npm run demo
```

Use [recording Swagger](http://127.0.0.1:3001/docs/) for this server.
To record another take, stop **this** server with `Ctrl+C`, run the Terminal 1
commands again to create a new database, and rerun the demo. Previous databases
remain untouched. The recording database is temporary; keep its printed path if
you want to demonstrate persistence before the operating system cleans it up.

Alternatively, keep the existing server and choose a different unused future
slot. The following selects 10:00 UTC two days from now; it must still be free:

```bash
DEMO_START=$(node -e 'const d=new Date();d.setUTCDate(d.getUTCDate()+2);d.setUTCHours(10,0,0,0);console.log(d.toISOString())')
BASE_URL=http://127.0.0.1:3001 DEMO_START="$DEMO_START" npm run demo
```

## Try a request manually in Swagger

1. Open `POST /appointments` and select **Try it out**.
2. Supply an `Idempotency-Key`, such as `manual-demo-1`.
3. Generate a valid start timestamp with the Node command above. Copy the value
   printed by `echo "$DEMO_START"` into `startsAt` below; the placeholder is not valid input.
4. Submit the following body, using a free slot:

```json
{
  "customerId": "customer-1",
  "vehicleId": "vehicle-1",
  "dealershipId": "dealer-1",
  "serviceTypeId": "diagnostics",
  "startsAt": "REPLACE_WITH_THE_GENERATED_UTC_TIMESTAMP"
}
```

Successful creation returns `201`. Repeat with the same key and unchanged body
to see a `200` replay. Change the body while keeping the key to see
`409 IDEMPOTENCY_CONFLICT`. Use a **new key for a new logical booking**; otherwise
an idempotency conflict can mask the business scenario you intended to demonstrate.

## Extra scenarios for discussion

Use independent free time slots or a fresh database for each scenario below.

| Scenario | Input or sequence | Expected result |
| --- | --- | --- |
| Wrong owner | `customer-1` with `vehicle-2` | `422 VEHICLE_OWNER_MISMATCH` |
| No qualified technician | `ev-check` at `dealer-1`, starting 10:00 UTC | `409 NO_CAPACITY` |
| EV service at the other dealership | `ev-check` at `dealer-2`, starting 10:00 UTC | `201`, `tech-3` and `bay-3` |
| Full duration exceeds opening hours | `diagnostics` starting 17:00 UTC | `422 OUTSIDE_OPENING_HOURS` |
| Back-to-back appointments | Diagnostics 10:00–12:00, then 12:00–14:00 with a new key | Both `201` |
| Two compatible resource pairs | Two different owned vehicles request oil changes at 10:00 UTC | Both `201`, using different bays and technicians |
| Persistence | Save the appointment ID, restart with the **same** `DATABASE_PATH`, GET that ID | `200`, same record |

Bookings must start in the future and within 90 days. Use `GET /availability` to
inspect bay/technician capacity; it does not reserve a slot or check a particular
vehicle's existing appointments. Final confirmation rechecks all booking rules.

## Troubleshooting

- Empty catalog: seed the same `DATABASE_PATH` that the server uses.
- Unexpected `409`: check existing bookings; seeding again does not clear them.
- `400`: check required IDs, UTC timestamp, future horizon and idempotency header.
- `503 DATABASE_BUSY`: another connection held the writer lock too long. Retry
  with the same key, honoring `Retry-After`, with bounded backoff.
- Native SQLite module error: use the same supported Node version for install
  and runtime. Stop the demo server, run `npm ci`, rebuild and restart.
