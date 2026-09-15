import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Type } from '@sinclair/typebox';
import type { Db } from './database.js';
import { checkAvailability } from './availability.js';
import { bookAppointment, getAppointment } from './scheduler.js';
import {
  Appointment, Availability, AvailabilityQuery, BookingBody, BookingHeaders,
  DomainError, ErrorResponse, IdParams, type AvailabilityInput, type BookingInput,
} from './contracts.js';

interface AppOptions { db: Db; now?: () => number; logger?: boolean; logLevel?: string }

export async function buildApp({ db, now = Date.now, logger = false, logLevel = 'info' }: AppOptions) {
  const app = Fastify({
    logger: logger ? {
      level: logLevel,
      serializers: { req: req => ({ method: req.method }), res: res => ({ statusCode: res.statusCode }) },
    } : false,
    bodyLimit: 16_384,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const metrics = new Map<string, { count: number; seconds: number }>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    // Only documented business routes become labels, never arbitrary URLs or IDs.
    if (!['/health', '/catalog', '/availability', '/appointments', '/appointments/:id', 'unmatched'].includes(route)) return;
    const label = `route="${route}",status="${reply.statusCode}"`;
    const current = metrics.get(label) ?? { count: 0, seconds: 0 };
    current.count++;
    current.seconds += reply.elapsedTime / 1000;
    metrics.set(label, current);
    request.log.info({ route, statusCode: reply.statusCode, durationMs: reply.elapsedTime }, 'request completed');
  });
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { code?: string; statusCode?: number; validation?: unknown };
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    if (err instanceof DomainError) {
      status = err.statusCode; code = err.code; message = err.message;
    } else if (err.code?.startsWith('SQLITE_BUSY')) {
      status = 503; code = 'DATABASE_BUSY'; message = 'Storage is busy. Retry with the same idempotency key.';
      reply.header('retry-after', '1');
    } else if (err.message.includes('appointment_overlap')) {
      status = 409; code = 'NO_CAPACITY'; message = 'A resource has an overlapping appointment.';
    } else if (err.validation || (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)) {
      status = err.statusCode ?? 400; code = 'INVALID_REQUEST'; message = 'Request does not match the API contract.';
    }
    if (status >= 500) request.log.error({ err, code }, 'request failed');
    return reply.code(status).send({ code, message, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    code: 'NOT_FOUND', message: 'Route does not exist.', requestId: request.id,
  }));

  await app.register(swagger, {
    openapi: {
      info: { title: 'Keyloop Service Scheduler', version: '1.0.0', description: 'Scenario A backend. Trusted local evaluation only; no authentication.' },
      tags: [{ name: 'Scheduling', description: 'Availability is advisory; booking atomically confirms resources.' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  const errors = { 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 422: ErrorResponse, 503: ErrorResponse, 500: ErrorResponse };
  app.get('/health', { schema: { response: { 200: Type.Object({ status: Type.Literal('ok') }), 503: ErrorResponse } } }, async () => {
    db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });
  app.get('/catalog', { schema: {
    description: 'Fictional reference data for the client stub. Opening hours and shifts are minutes after UTC midnight.',
  } }, async () => ({
    dealerships: db.prepare('SELECT * FROM dealerships ORDER BY id').all(),
    customers: db.prepare('SELECT * FROM customers ORDER BY id').all(),
    vehicles: db.prepare('SELECT * FROM vehicles ORDER BY id').all(),
    serviceTypes: db.prepare('SELECT * FROM service_types ORDER BY id').all(),
    bays: db.prepare('SELECT * FROM bays ORDER BY id').all(),
    technicians: db.prepare('SELECT * FROM technicians ORDER BY id').all(),
    qualifications: db.prepare('SELECT * FROM qualifications ORDER BY technician_id, service_type_id').all(),
  }));
  app.get<{ Querystring: AvailabilityInput }>('/availability', {
    schema: { tags: ['Scheduling'], querystring: AvailabilityQuery, response: { 200: Availability, ...errors } },
  }, async request => checkAvailability(db, request.query, now()));
  app.post<{ Body: BookingInput; Headers: { 'idempotency-key': string } }>('/appointments', {
    schema: {
      tags: ['Scheduling'], body: BookingBody, headers: BookingHeaders,
      description: 'Requires Idempotency-Key. 201 for creation, 200 for identical replay, 409 if key reused for different input. Successful responses include Location and Idempotency-Replayed headers.',
      response: { 200: Appointment, 201: Appointment, ...errors },
    },
  }, async (request, reply) => {
    const result = bookAppointment(db, request.body, request.headers['idempotency-key'], now);
    request.log.info({ appointmentId: result.appointment.id, replayed: result.replayed }, 'booking confirmed');
    return reply.code(result.replayed ? 200 : 201)
      .header('location', `/appointments/${result.appointment.id}`)
      .header('idempotency-replayed', String(result.replayed)).send(result.appointment);
  });
  app.get<{ Params: { id: string } }>('/appointments/:id', {
    schema: { tags: ['Scheduling'], params: IdParams, response: { 200: Appointment, ...errors } },
  }, async request => getAppointment(db, request.params.id));
  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    const lines = ['# TYPE http_requests_total counter', '# TYPE http_request_duration_seconds_sum counter'];
    for (const [labels, values] of metrics) {
      lines.push(`http_requests_total{${labels}} ${values.count}`);
      lines.push(`http_request_duration_seconds_sum{${labels}} ${values.seconds}`);
    }
    return reply.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });
  await app.ready();
  return app;
}
