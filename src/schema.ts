export const schema = `
CREATE TABLE dealerships (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  opens_minute INTEGER NOT NULL CHECK(opens_minute >= 0),
  closes_minute INTEGER NOT NULL CHECK(closes_minute <= 1440 AND closes_minute > opens_minute)
) STRICT;
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT;
CREATE TABLE vehicles (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  vin TEXT NOT NULL UNIQUE, UNIQUE(id, customer_id)
) STRICT;
CREATE TABLE service_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0 AND duration_minutes <= 480)
) STRICT;
CREATE TABLE bays (
  id TEXT PRIMARY KEY, dealership_id TEXT NOT NULL REFERENCES dealerships(id),
  name TEXT NOT NULL, UNIQUE(id, dealership_id)
) STRICT;
CREATE TABLE technicians (
  id TEXT PRIMARY KEY, dealership_id TEXT NOT NULL REFERENCES dealerships(id),
  name TEXT NOT NULL, shift_start INTEGER NOT NULL CHECK(shift_start >= 0),
  shift_end INTEGER NOT NULL CHECK(shift_end <= 1440 AND shift_end > shift_start),
  UNIQUE(id, dealership_id)
) STRICT;
CREATE TABLE qualifications (
  technician_id TEXT NOT NULL REFERENCES technicians(id),
  service_type_id TEXT NOT NULL REFERENCES service_types(id),
  PRIMARY KEY(technician_id, service_type_id)
) STRICT;
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  vehicle_id TEXT NOT NULL,
  dealership_id TEXT NOT NULL REFERENCES dealerships(id),
  service_type_id TEXT NOT NULL REFERENCES service_types(id),
  technician_id TEXT NOT NULL, bay_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK(ends_at > starts_at),
  created_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE, request_fingerprint TEXT NOT NULL,
  FOREIGN KEY(vehicle_id, customer_id) REFERENCES vehicles(id, customer_id),
  FOREIGN KEY(technician_id, dealership_id) REFERENCES technicians(id, dealership_id),
  FOREIGN KEY(bay_id, dealership_id) REFERENCES bays(id, dealership_id),
  FOREIGN KEY(technician_id, service_type_id) REFERENCES qualifications(technician_id, service_type_id)
) STRICT;
CREATE INDEX appointments_bay_window ON appointments(bay_id, starts_at, ends_at);
CREATE INDEX appointments_technician_window ON appointments(technician_id, starts_at, ends_at);
CREATE INDEX appointments_vehicle_window ON appointments(vehicle_id, starts_at, ends_at);
CREATE INDEX bays_dealership ON bays(dealership_id);
CREATE INDEX technicians_dealership ON technicians(dealership_id);
CREATE TRIGGER prevent_overlapping_appointments BEFORE INSERT ON appointments
WHEN EXISTS (
  SELECT 1 FROM appointments a
  WHERE a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
    AND (a.bay_id = NEW.bay_id OR a.technician_id = NEW.technician_id OR a.vehicle_id = NEW.vehicle_id)
)
BEGIN
  SELECT RAISE(ABORT, 'appointment_overlap');
END;
CREATE TRIGGER appointments_immutable BEFORE UPDATE ON appointments
BEGIN
  SELECT RAISE(ABORT, 'appointments_are_immutable');
END;
PRAGMA user_version = 1;
`;
