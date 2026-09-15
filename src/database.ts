import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { schema } from './schema.js';

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { timeout: 3000 });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true });
      if (version === 0) db.exec(schema);
      else if (version !== 1) throw new Error(`Unsupported database version: ${version}`);
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
