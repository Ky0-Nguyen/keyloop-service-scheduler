import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appFixture, booking } from './helpers.js';

test('HTTP booking, Location retrieval, replay and conflict match the contract', async t => {
  const { app, close } = await appFixture(); t.after(close);
  const request = { method: 'POST' as const, url: '/appointments', headers: { 'idempotency-key': 'api-1' }, payload: booking };
  const created = await app.inject(request);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.headers['idempotency-replayed'], 'false');
  assert.ok(created.headers['x-request-id']);
  assert.equal(created.json().idempotency_key, undefined);
  const read = await app.inject({ url: String(created.headers.location) });
  assert.deepEqual(read.json(), created.json());
  const replay = await app.inject(request);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers['idempotency-replayed'], 'true');
  assert.deepEqual(replay.json(), created.json());
  const conflict = await app.inject({ ...request, payload: { ...booking, vehicleId: 'vehicle-3' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'IDEMPOTENCY_CONFLICT');
});

for (const [name, payload, headers] of [
  ['missing key', booking, {}],
  ['invalid key', booking, { 'idempotency-key': 'invalid key' }],
  ['missing fields', {}, { 'idempotency-key': 'key' }],
  ['unknown fields', { ...booking, duration: 1 }, { 'idempotency-key': 'key' }],
  ['wrong type', { ...booking, vehicleId: 1 }, { 'idempotency-key': 'key' }],
  ['missing zone', { ...booking, startsAt: '2030-01-02T10:00:00' }, { 'idempotency-key': 'key' }],
] as const) {
  test(`HTTP validation: ${name}`, async t => {
    const { app, close } = await appFixture(); t.after(close);
    const response = await app.inject({ method: 'POST', url: '/appointments', payload, headers });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'INVALID_REQUEST');
    assert.equal(response.json().requestId, response.headers['x-request-id']);
  });
}

test('malformed JSON, body limit and content type produce safe client errors', async t => {
  const { app, close } = await appFixture(); t.after(close);
  for (const [payload, contentType, expected] of [
    ['{broken', 'application/json', 400], ['x'.repeat(17_000), 'application/json', 413], ['hello', 'application/xml', 415],
  ] as const) {
    const result = await app.inject({ method: 'POST', url: '/appointments', headers: { 'content-type': contentType }, payload });
    assert.equal(result.statusCode, expected);
    assert.equal(result.json().code, 'INVALID_REQUEST');
  }
});

test('availability is advisory and reports exhausted qualified capacity', async t => {
  const { app, close } = await appFixture(); t.after(close);
  const url = '/availability?' + new URLSearchParams({ dealershipId: booking.dealershipId, serviceTypeId: booking.serviceTypeId, startsAt: booking.startsAt });
  assert.equal((await app.inject(url)).json().available, true);
  await app.inject({ method: 'POST', url: '/appointments', headers: { 'idempotency-key': 'book' }, payload: booking });
  const response = await app.inject(url);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().available, false);
  assert.deepEqual(response.json().technicianIds, []);
  const conflict = await app.inject({ method: 'POST', url: '/appointments', headers: { 'idempotency-key': 'other' },
    payload: { ...booking, customerId: 'customer-2', vehicleId: 'vehicle-2' } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'NO_CAPACITY');
});

test('reference data, health, unknown routes, API docs and metrics are accessible', async t => {
  const { app, close } = await appFixture(); t.after(close);
  assert.deepEqual((await app.inject('/health')).json(), { status: 'ok' });
  assert.equal((await app.inject('/catalog')).json().dealerships.length, 2);
  for (const url of ['/appointments/missing', '/does-not-exist']) {
    assert.equal((await app.inject(url)).statusCode, 404);
  }
  const spec = (await app.inject('/docs/json')).json();
  assert.ok(spec.paths['/appointments'].post.parameters.some((p: { name: string }) => p.name === 'idempotency-key'));
  assert.ok(spec.paths['/availability']);
  assert.equal((await app.inject('/docs/')).statusCode, 200);
  const metrics = await app.inject('/metrics');
  assert.match(metrics.body, /http_requests_total\{route="\/health",status="200"\} 1/);
  assert.doesNotMatch(metrics.body, /does-not-exist|appointments\/missing/);
});

test('unexpected internal errors do not leak details', async t => {
  const { app, db } = await appFixture(); t.after(() => app.close());
  db.close();
  const response = await app.inject('/catalog');
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().message, 'An unexpected error occurred.');
  assert.doesNotMatch(response.body, /database|SQL|stack/);
});
