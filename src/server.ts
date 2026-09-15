import { buildApp } from './app.js';
import { openDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const db = openDatabase(process.env.DATABASE_PATH ?? './data/scheduler.db');
try {
  const app = await buildApp({ db, logger: true, logLevel: process.env.LOG_LEVEL ?? 'info' });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10_000).unref();
    try { await app.close(); } finally { db.close(); clearTimeout(deadline); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
} catch (error) {
  if (db.open) db.close();
  throw error;
}
