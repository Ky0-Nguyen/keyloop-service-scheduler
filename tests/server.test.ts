import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fixture } from './helpers.js';

test('compiled server starts, serves real HTTP and shuts down cleanly on SIGTERM', { timeout: 15_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'keyloop-server-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'scheduler.db');
  fixture(path).close();
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port), DATABASE_PATH: path, LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data.toString(); });
  child.stderr.on('data', data => { logs += data.toString(); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
  });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', () => reject(new Error(`Server exited before ready: ${logs}`)));
    child.stdout.on('data', () => { if (logs.includes('Server listening at')) resolve(); });
  });
  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  assert.deepEqual(await exit, [0, null], logs);
});
