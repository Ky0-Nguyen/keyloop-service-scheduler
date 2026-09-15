import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../dist/database.js';
import { bookAppointment } from '../dist/scheduler.js';

const db = openDatabase(workerData.path);
const gate = new Int32Array(workerData.gate);
parentPort.postMessage({ ready: true });
Atomics.wait(gate, 0, 0);
try {
  const result = bookAppointment(db, workerData.booking, workerData.key, () => workerData.now);
  parentPort.postMessage({ status: result.replayed ? 200 : 201, id: result.appointment.id });
} catch (error) {
  parentPort.postMessage({ status: error.statusCode ?? 500, code: error.code });
} finally {
  db.close();
  parentPort.close();
}
