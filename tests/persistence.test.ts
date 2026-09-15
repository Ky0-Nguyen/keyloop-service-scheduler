import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/database.js';
import { buildApp } from '../src/app.js';
import { bookAppointment } from '../src/scheduler.js';
import { seedDatabase } from '../src/fixtures.js';
import { booking, fixture, NOW } from './helpers.js';

test('disk persistence and idempotency survive application and connection restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'keyloop-restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'scheduler.db');
  const first = fixture(path);
  const saved = bookAppointment(first, booking, 'persistent-key', () => NOW).appointment;
  first.close();
  const reopened = openDatabase(path);
  const app = await buildApp({ db: reopened, now: () => NOW });
  t.after(async () => { await app.close(); reopened.close(); });
  seedDatabase(reopened);
  assert.deepEqual((await app.inject(`/appointments/${saved.id}`)).json(), saved);
  const response = await app.inject({ method: 'POST', url: '/appointments', headers: { 'idempotency-key': 'persistent-key' }, payload: booking });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, saved.id);
});

for (const sameKey of [false, true]) {
  test(`independent concurrent writers: ${sameKey ? 'same key replays' : 'competing bookings never double book'}`, { timeout: 15_000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'keyloop-race-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'scheduler.db');
    fixture(path).close();
    const gate = new SharedArrayBuffer(4);
    const workerInputs = [booking, sameKey ? booking : { ...booking, customerId: 'customer-2', vehicleId: 'vehicle-2' }];
    const workers = workerInputs.map((payload, index) => new Worker(new URL('./booking-worker.mjs', import.meta.url), {
      workerData: { path, gate, booking: payload, now: NOW, key: sameKey ? 'shared-key' : `key-${index}` },
    }));
    t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
    let ready = 0;
    const outcomes = await Promise.all(workers.map(worker => new Promise<{ status: number; id?: string; code?: string }>((resolve, reject) => {
      let result: { status: number; id?: string; code?: string } | undefined;
      worker.on('error', reject);
      worker.on('exit', code => result && code === 0 ? resolve(result) : reject(new Error(`Worker exited ${code} before successful completion`)));
      worker.on('message', message => {
        if (message.ready) {
          if (++ready === workers.length) {
            Atomics.store(new Int32Array(gate), 0, 1);
            Atomics.notify(new Int32Array(gate), 0);
          }
        } else result = message;
      });
    })));
    assert.deepEqual(outcomes.map(result => result.status).sort(), sameKey ? [200, 201] : [201, 409]);
    if (sameKey) assert.equal(outcomes[0]?.id, outcomes[1]?.id);
    else assert.equal(outcomes.find(result => result.status === 409)?.code, 'NO_CAPACITY');
    const db = openDatabase(path);
    try {
      assert.equal((db.prepare('SELECT count(*) AS n FROM appointments').get() as { n: number }).n, 1);
    } finally { db.close(); }
  });
}

test('storage contention returns 503 with retry advice and later retry succeeds', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'keyloop-busy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'scheduler.db');
  const db = fixture(path);
  const locker = openDatabase(path);
  db.pragma('busy_timeout = 1');
  const app = await buildApp({ db, now: () => NOW });
  t.after(async () => { await app.close(); db.close(); locker.close(); });
  const request = { method: 'POST' as const, url: '/appointments', headers: { 'idempotency-key': 'busy-key' }, payload: booking };
  locker.exec('BEGIN IMMEDIATE');
  try {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.json().code, 'DATABASE_BUSY');
  } finally { locker.exec('ROLLBACK'); }
  assert.equal((await app.inject(request)).statusCode, 201);
});

test('unknown schema versions are rejected without destructive migration', t => {
  const directory = mkdtempSync(join(tmpdir(), 'keyloop-version-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'scheduler.db');
  const db = new Database(path);
  db.pragma('user_version = 99'); db.close();
  assert.throws(() => openDatabase(path), /Unsupported database version: 99/);
});
