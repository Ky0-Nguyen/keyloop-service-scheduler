import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookAppointment, getAppointment } from '../src/scheduler.js';
import { checkAvailability } from '../src/availability.js';
import { DomainError } from '../src/contracts.js';
import { booking, fixture, NOW } from './helpers.js';

const hasCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
const otherVehicle = { customerId: 'customer-2', vehicleId: 'vehicle-2' };

test('confirmation links all entities with server-derived service duration', t => {
  const db = fixture(); t.after(() => db.close());
  const result = bookAppointment(db, booking, 'first', () => NOW);
  assert.equal(result.replayed, false);
  assert.deepEqual(result.appointment, {
    ...booking, id: result.appointment.id, startsAt: '2030-01-02T10:00:00.000Z',
    endsAt: '2030-01-02T12:00:00.000Z', technicianId: 'tech-1', bayId: 'bay-1',
    createdAt: '2030-01-01T00:00:00.000Z', status: 'confirmed',
  });
  assert.deepEqual(getAppointment(db, result.appointment.id), result.appointment);
});

for (const startsAt of ['09:00:00', '10:00:00', '11:00:00']) {
  test(`rejects overlapping duration at ${startsAt} even when another bay is free`, t => {
    const db = fixture(); t.after(() => db.close());
    bookAppointment(db, booking, 'first', () => NOW);
    assert.throws(() => bookAppointment(db, { ...booking, ...otherVehicle,
      startsAt: `2030-01-02T${startsAt}Z`,
    }, 'second', () => NOW), hasCode('NO_CAPACITY'));
    assert.equal((db.prepare('SELECT count(*) AS n FROM appointments').get() as { n: number }).n, 1);
  });
}

test('a longer requested service cannot contain a shorter existing service', t => {
  const db = fixture(); t.after(() => db.close());
  bookAppointment(db, { ...booking, serviceTypeId: 'oil-change', startsAt: '2030-01-02T10:30:00Z' }, 'oil', () => NOW);
  assert.throws(() => bookAppointment(db, { ...booking, ...otherVehicle }, 'diagnostic', () => NOW), hasCode('NO_CAPACITY'));
});

test('adjacent bookings at either end of an existing interval are allowed', t => {
  const db = fixture(); t.after(() => db.close());
  bookAppointment(db, booking, 'middle', () => NOW);
  for (const hour of ['08', '12']) {
    const result = bookAppointment(db, { ...booking, startsAt: `2030-01-02T${hour}:00:00Z` }, hour, () => NOW);
    assert.equal(result.appointment.technicianId, 'tech-1');
  }
});

test('second compatible pair is selected, then finite capacity is exhausted', t => {
  const db = fixture(); t.after(() => db.close());
  bookAppointment(db, { ...booking, serviceTypeId: 'oil-change' }, 'first', () => NOW);
  const second = bookAppointment(db, { ...booking, ...otherVehicle, serviceTypeId: 'oil-change' }, 'second', () => NOW);
  assert.equal(second.appointment.bayId, 'bay-2');
  assert.equal(second.appointment.technicianId, 'tech-2');
  assert.throws(() => bookAppointment(db, { ...booking, vehicleId: 'vehicle-3', serviceTypeId: 'oil-change' }, 'third', () => NOW), hasCode('NO_CAPACITY'));
});

test('free technician cannot compensate for occupied bays', t => {
  const db = fixture(); t.after(() => db.close());
  db.prepare('DELETE FROM bays WHERE id = ?').run('bay-2');
  bookAppointment(db, { ...booking, serviceTypeId: 'oil-change' }, 'first', () => NOW);
  const available = checkAvailability(db, { ...booking, serviceTypeId: 'oil-change' }, NOW);
  assert.deepEqual(available.bayIds, []);
  assert.deepEqual(available.technicianIds, ['tech-2']);
  assert.equal(available.available, false);
});

test('skills and dealership isolation exclude otherwise idle resources', t => {
  const db = fixture(); t.after(() => db.close());
  assert.equal(checkAvailability(db, { ...booking, serviceTypeId: 'ev-check' }, NOW).available, false);
  const result = bookAppointment(db, { ...booking, dealershipId: 'dealer-2', serviceTypeId: 'ev-check' }, 'ev', () => NOW);
  assert.equal(result.appointment.technicianId, 'tech-3');
  assert.equal(result.appointment.bayId, 'bay-3');
});

test('vehicle cannot be booked at two dealerships at the same time', t => {
  const db = fixture(); t.after(() => db.close());
  bookAppointment(db, booking, 'first', () => NOW);
  assert.throws(() => bookAppointment(db, { ...booking, dealershipId: 'dealer-2', serviceTypeId: 'oil-change' }, 'second', () => NOW), hasCode('VEHICLE_UNAVAILABLE'));
});

test('entire service must fit technician shift, including fractional minutes', t => {
  const db = fixture(); t.after(() => db.close());
  db.prepare('DELETE FROM qualifications WHERE technician_id = ? AND service_type_id = ?').run('tech-1', 'oil-change');
  for (const time of ['08:59:59', '16:00:01']) {
    assert.equal(checkAvailability(db, { ...booking, serviceTypeId: 'oil-change', startsAt: `2030-01-02T${time}Z` }, NOW).available, false);
  }
  for (const time of ['09:00:00', '16:00:00']) {
    assert.equal(checkAvailability(db, { ...booking, serviceTypeId: 'oil-change', startsAt: `2030-01-02T${time}Z` }, NOW).available, true);
  }
});

for (const time of ['07:59:59', '16:00:01', '23:00:00']) {
  test(`rejects a service outside dealership hours: ${time}`, t => {
    const db = fixture(); t.after(() => db.close());
    assert.throws(() => bookAppointment(db, { ...booking, startsAt: `2030-01-02T${time}Z` }, 'time', () => NOW), hasCode('OUTSIDE_OPENING_HOURS'));
  });
}

for (const startsAt of ['nonsense', '2030-02-30T10:00:00Z', '2030-01-01T00:00:00Z',
  '2029-12-31T10:00:00Z', '2030-04-02T10:00:00Z', '2030-01-02T10:00:00+00:00']) {
  test(`rejects invalid/past/out-of-horizon timestamp: ${startsAt}`, t => {
    const db = fixture(); t.after(() => db.close());
    assert.throws(() => bookAppointment(db, { ...booking, startsAt }, 'bad-time', () => NOW), hasCode('INVALID_TIME'));
  });
}

test('opening/closing and exactly 90-day boundaries are inclusive', t => {
  const db = fixture(); t.after(() => db.close());
  for (const time of ['08:00:00', '16:00:00']) {
    assert.equal(checkAvailability(db, { ...booking, startsAt: `2030-01-02T${time}Z` }, NOW).available, true);
  }
  const now = Date.parse('2030-01-01T10:00:00Z');
  assert.equal(checkAvailability(db, { ...booking, startsAt: new Date(now + 90 * 86_400_000).toISOString() }, now).available, true);
});

for (const field of ['vehicleId', 'customerId', 'dealershipId', 'serviceTypeId']) {
  test(`unknown ${field} cannot create an appointment`, t => {
    const db = fixture(); t.after(() => db.close());
    assert.throws(() => bookAppointment(db, { ...booking, [field]: 'missing' }, 'unknown', () => NOW), hasCode('REFERENCE_NOT_FOUND'));
  });
}

test('ownership mismatch is rejected', t => {
  const db = fixture(); t.after(() => db.close());
  assert.throws(() => bookAppointment(db, { ...booking, customerId: 'customer-2' }, 'owner', () => NOW), hasCode('VEHICLE_OWNER_MISMATCH'));
});

test('idempotency canonicalizes time, survives changed clock and rejects changed payload', t => {
  const db = fixture(); t.after(() => db.close());
  const first = bookAppointment(db, booking, 'retry', () => NOW);
  const replay = bookAppointment(db, { ...booking, startsAt: '2030-01-02T10:00:00.000Z' }, 'retry', () => NOW + 365 * 86_400_000);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.appointment, first.appointment);
  assert.throws(() => bookAppointment(db, { ...booking, vehicleId: 'vehicle-3' }, 'retry', () => NOW), hasCode('IDEMPOTENCY_CONFLICT'));
});

test('failed transaction leaves no appointment or consumed idempotency key', t => {
  const db = fixture(); t.after(() => db.close());
  assert.throws(() => bookAppointment(db, { ...booking, customerId: 'customer-2' }, 'retry', () => NOW));
  assert.equal(bookAppointment(db, booking, 'retry', () => NOW).replayed, false);
});

test('database guards reject direct overlap inserts and updates', t => {
  const db = fixture(); t.after(() => db.close());
  const first = bookAppointment(db, booking, 'first', () => NOW);
  assert.throws(() => db.exec(`INSERT INTO appointments SELECT
    'rogue', customer_id, vehicle_id, dealership_id, service_type_id, technician_id, bay_id,
    starts_at, ends_at, created_at, 'rogue-key', request_fingerprint FROM appointments`), /appointment_overlap/);
  assert.throws(() => db.prepare('UPDATE appointments SET starts_at = starts_at + 1 WHERE id = ?').run(first.appointment.id), /appointments_are_immutable/);
});
