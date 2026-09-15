import { openDatabase } from '../src/database.js';
import { seedDatabase } from '../src/fixtures.js';
import { buildApp } from '../src/app.js';

export const NOW = Date.parse('2030-01-01T00:00:00Z');
export const booking = {
  customerId: 'customer-1', vehicleId: 'vehicle-1', dealershipId: 'dealer-1',
  serviceTypeId: 'diagnostics', startsAt: '2030-01-02T10:00:00Z',
};
export function fixture(path = ':memory:') {
  const db = openDatabase(path);
  seedDatabase(db);
  return db;
}
export async function appFixture() {
  const db = fixture();
  const app = await buildApp({ db, now: () => NOW });
  return { db, app, close: async () => { await app.close(); db.close(); } };
}
