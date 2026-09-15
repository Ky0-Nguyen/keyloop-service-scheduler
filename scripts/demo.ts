import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const date = new Date();
date.setUTCDate(date.getUTCDate() + 1);
date.setUTCHours(10, 0, 0, 0);
const startsAt = process.env.DEMO_START ?? date.toISOString();
const body = { customerId: 'customer-1', vehicleId: 'vehicle-1', dealershipId: 'dealer-1', serviceTypeId: 'diagnostics', startsAt };
const key = randomUUID();

async function call(path: string, expected: number, options?: RequestInit) {
  const response = await fetch(base + path, options);
  const data = await response.json();
  console.log(`\n${options?.method ?? 'GET'} ${path} -> ${response.status}`);
  console.log(JSON.stringify(data, null, 2));
  assert.equal(response.status, expected, 'Unexpected status. Use a fresh demo database or choose DEMO_START.');
  return data;
}
const post = (payload: typeof body, idempotencyKey: string) => ({
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(payload),
});
await call('/health', 200);
await call('/availability?' + new URLSearchParams({ dealershipId: body.dealershipId, serviceTypeId: body.serviceTypeId, startsAt }), 200);
const appointment = await call('/appointments', 201, post(body, key));
await call('/appointments/' + appointment.id, 200);
const replay = await call('/appointments', 200, post(body, key));
assert.equal(replay.id, appointment.id);
await call('/appointments', 409, post({ ...body, customerId: 'customer-2', vehicleId: 'vehicle-2' }, randomUUID()));
console.log('\nDemo passed: persisted confirmation, safe retry and resource conflict.');
