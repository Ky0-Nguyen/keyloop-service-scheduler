import { openDatabase } from './database.js';
import { seedDatabase } from './fixtures.js';

const path = process.env.DATABASE_PATH ?? './data/scheduler.db';
const db = openDatabase(path);
try {
  seedDatabase(db);
  console.log(`Fictional demo data is ready in ${path}. Existing appointments are preserved.`);
} finally { db.close(); }
