import type { Db } from './database.js';
import { DomainError, type AvailabilityInput } from './contracts.js';

const DAY = 86_400_000;

export function parseStart(value: string): number {
  const normalized = value.length === 20 ? value.replace('Z', '.000Z') : value;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== normalized) {
    throw new DomainError(400, 'INVALID_TIME', 'Use a real UTC date with seconds and optional three-digit milliseconds.');
  }
  return time;
}

export function resolveWindow(db: Db, input: AvailabilityInput, now: number) {
  const start = parseStart(input.startsAt);
  if (start <= now || start > now + 90 * DAY) {
    throw new DomainError(400, 'INVALID_TIME', 'Start must be in the future and within 90 days.');
  }
  const dealer = db.prepare('SELECT opens_minute, closes_minute FROM dealerships WHERE id = ?')
    .get(input.dealershipId) as { opens_minute: number; closes_minute: number } | undefined;
  const service = db.prepare('SELECT duration_minutes FROM service_types WHERE id = ?')
    .get(input.serviceTypeId) as { duration_minutes: number } | undefined;
  if (!dealer || !service) throw new DomainError(404, 'REFERENCE_NOT_FOUND', 'Dealership or service type does not exist.');
  const end = start + service.duration_minutes * 60_000;
  const midnight = Math.floor(start / DAY) * DAY;
  const startMinute = (start - midnight) / 60_000;
  const endMinute = (end - midnight) / 60_000;
  if (startMinute < dealer.opens_minute || endMinute > dealer.closes_minute) {
    throw new DomainError(422, 'OUTSIDE_OPENING_HOURS', 'The entire service must fit within dealership opening hours.');
  }
  return { start, end, startMinute, endMinute };
}

export function findResources(db: Db, input: AvailabilityInput, window: ReturnType<typeof resolveWindow>) {
  const bayIds = (db.prepare(`
    SELECT b.id FROM bays b WHERE b.dealership_id = ? AND NOT EXISTS (
      SELECT 1 FROM appointments a WHERE a.bay_id = b.id AND a.starts_at < ? AND a.ends_at > ?
    ) ORDER BY b.id
  `).all(input.dealershipId, window.end, window.start) as { id: string }[]).map(row => row.id);
  const technicianIds = (db.prepare(`
    SELECT t.id FROM technicians t
    JOIN qualifications q ON q.technician_id = t.id AND q.service_type_id = ?
    WHERE t.dealership_id = ? AND t.shift_start <= ? AND t.shift_end >= ? AND NOT EXISTS (
      SELECT 1 FROM appointments a WHERE a.technician_id = t.id AND a.starts_at < ? AND a.ends_at > ?
    ) ORDER BY t.id
  `).all(input.serviceTypeId, input.dealershipId, window.startMinute, window.endMinute,
    window.end, window.start) as { id: string }[]).map(row => row.id);
  return { bayIds, technicianIds };
}

export function checkAvailability(db: Db, input: AvailabilityInput, now: number) {
  const window = resolveWindow(db, input, now);
  const resources = findResources(db, input, window);
  return {
    available: resources.bayIds.length > 0 && resources.technicianIds.length > 0,
    startsAt: new Date(window.start).toISOString(), endsAt: new Date(window.end).toISOString(), ...resources,
  };
}
