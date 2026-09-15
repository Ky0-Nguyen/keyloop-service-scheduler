import { Type, type Static } from '@sinclair/typebox';

const id = Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' });
const timestamp = Type.String({
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$',
  description: 'UTC timestamp, e.g. 2030-01-02T10:00:00Z. Must be within the next 90 days.',
});
export const AvailabilityQuery = Type.Object({
  dealershipId: id, serviceTypeId: id, startsAt: timestamp,
}, { additionalProperties: false });
export const BookingBody = Type.Object({
  ...AvailabilityQuery.properties, customerId: id, vehicleId: id,
}, { additionalProperties: false });
export const BookingHeaders = Type.Object({
  'idempotency-key': Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.:-]+$' }),
});
export const IdParams = Type.Object({ id });
export const Appointment = Type.Object({
  id, customerId: id, vehicleId: id, dealershipId: id, serviceTypeId: id,
  technicianId: id, bayId: id, startsAt: Type.String(), endsAt: Type.String(),
  createdAt: Type.String(), status: Type.Literal('confirmed'),
});
export const Availability = Type.Object({
  available: Type.Boolean(), startsAt: Type.String(), endsAt: Type.String(),
  bayIds: Type.Array(id), technicianIds: Type.Array(id),
});
export const ErrorResponse = Type.Object({
  code: Type.String(), message: Type.String(), requestId: Type.String(),
});
export type AvailabilityInput = Static<typeof AvailabilityQuery>;
export type BookingInput = Static<typeof BookingBody>;
export type AppointmentView = Static<typeof Appointment>;

export class DomainError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}
