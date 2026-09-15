import { createHash, randomUUID } from 'node:crypto';
import type { Db } from './database.js';
import { DomainError, type AppointmentView, type BookingInput } from './contracts.js';
import { findResources, parseStart, resolveWindow } from './availability.js';

interface AppointmentRow {
  id: string; customer_id: string; vehicle_id: string; dealership_id: string;
  service_type_id: string; technician_id: string; bay_id: string;
  starts_at: number; ends_at: number; created_at: number; request_fingerprint: string;
}

function toView(row: AppointmentRow): AppointmentView {
  return {
    id: row.id, customerId: row.customer_id, vehicleId: row.vehicle_id,
    dealershipId: row.dealership_id, serviceTypeId: row.service_type_id,
    technicianId: row.technician_id, bayId: row.bay_id,
    startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(), status: 'confirmed',
  };
}

export function getAppointment(db: Db, id: string): AppointmentView {
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as AppointmentRow | undefined;
  if (!row) throw new DomainError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment does not exist.');
  return toView(row);
}

export function bookAppointment(db: Db, input: BookingInput, key: string, now: () => number = Date.now) {
  const fingerprint = createHash('sha256').update(JSON.stringify([
    input.customerId, input.vehicleId, input.dealershipId, input.serviceTypeId, parseStart(input.startsAt),
  ])).digest('hex');

  // Acquire the write lock BEFORE reading availability or idempotency state.
  // No network work or await belongs inside this transaction.
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM appointments WHERE idempotency_key = ?')
      .get(key) as AppointmentRow | undefined;
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used for a different request.');
      }
      return { appointment: toView(existing), replayed: true };
    }
    const createdAt = now();
    const window = resolveWindow(db, input, createdAt);
    const vehicle = db.prepare('SELECT customer_id FROM vehicles WHERE id = ?')
      .get(input.vehicleId) as { customer_id: string } | undefined;
    const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customerId);
    if (!vehicle || !customer) throw new DomainError(404, 'REFERENCE_NOT_FOUND', 'Customer or vehicle does not exist.');
    if (vehicle.customer_id !== input.customerId) {
      throw new DomainError(422, 'VEHICLE_OWNER_MISMATCH', 'Vehicle does not belong to the supplied customer.');
    }
    if (db.prepare('SELECT 1 FROM appointments WHERE vehicle_id = ? AND starts_at < ? AND ends_at > ?')
      .get(input.vehicleId, window.end, window.start)) {
      throw new DomainError(409, 'VEHICLE_UNAVAILABLE', 'Vehicle already has an overlapping appointment.');
    }
    const { bayIds, technicianIds } = findResources(db, input, window);
    const bayId = bayIds[0];
    const technicianId = technicianIds[0];
    if (!bayId || !technicianId) {
      throw new DomainError(409, 'NO_CAPACITY', 'No bay and qualified technician are available for the entire service.');
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO appointments (
      id, customer_id, vehicle_id, dealership_id, service_type_id, technician_id, bay_id,
      starts_at, ends_at, created_at, idempotency_key, request_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.customerId, input.vehicleId, input.dealershipId, input.serviceTypeId, technicianId, bayId,
      window.start, window.end, createdAt, key, fingerprint,
    );
    return { appointment: getAppointment(db, id), replayed: false };
  }).immediate();
}
