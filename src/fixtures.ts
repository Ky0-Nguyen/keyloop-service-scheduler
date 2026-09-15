import type { Db } from './database.js';

/** Explicit, repeatable demo data. Never executed automatically by the server. */
export function seedDatabase(db: Db): void {
  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO dealerships VALUES ('dealer-1', 'Central Motors', 480, 1080);
      INSERT OR IGNORE INTO dealerships VALUES ('dealer-2', 'Riverside Motors', 480, 1080);
      INSERT OR IGNORE INTO customers VALUES ('customer-1', 'Alex Demo'), ('customer-2', 'Sam Demo');
      INSERT OR IGNORE INTO vehicles VALUES
        ('vehicle-1', 'customer-1', 'DEMO0000000000001'),
        ('vehicle-2', 'customer-2', 'DEMO0000000000002'),
        ('vehicle-3', 'customer-1', 'DEMO0000000000003');
      INSERT OR IGNORE INTO service_types VALUES
        ('oil-change', 'Oil change', 60), ('diagnostics', 'Engine diagnostics', 120),
        ('ev-check', 'EV battery inspection', 90);
      INSERT OR IGNORE INTO bays VALUES
        ('bay-1', 'dealer-1', 'Bay 1'), ('bay-2', 'dealer-1', 'Bay 2'),
        ('bay-3', 'dealer-2', 'Bay 1');
      INSERT OR IGNORE INTO technicians VALUES
        ('tech-1', 'dealer-1', 'Taylor Demo', 480, 1080),
        ('tech-2', 'dealer-1', 'Jordan Demo', 540, 1020),
        ('tech-3', 'dealer-2', 'Casey Demo', 480, 1080);
      INSERT OR IGNORE INTO qualifications VALUES
        ('tech-1', 'oil-change'), ('tech-1', 'diagnostics'),
        ('tech-2', 'oil-change'), ('tech-3', 'oil-change'), ('tech-3', 'ev-check');
    `);
  }).immediate();
}
