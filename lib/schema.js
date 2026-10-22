// Esquema de la base de datos D1. Todas las sentencias son idempotentes (IF NOT EXISTS),
// así que se aplican solas la primera vez que la API recibe una petición en cada instancia.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('creator','admin','user')),
     password_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id),
     expires_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS clients (
     id TEXT PRIMARY KEY,
     full_name TEXT NOT NULL,
     cedula TEXT UNIQUE,
     phone TEXT,
     email TEXT,
     birth_date TEXT,
     notes TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS plans (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     price REAL NOT NULL,
     duration_days INTEGER NOT NULL,
     active INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS memberships (
     id TEXT PRIMARY KEY,
     client_id TEXT NOT NULL REFERENCES clients(id),
     plan_id TEXT NOT NULL REFERENCES plans(id),
     start_date TEXT NOT NULL,
     end_date TEXT NOT NULL,
     amount REAL NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_client ON memberships(client_id, end_date)`,
  `CREATE TABLE IF NOT EXISTS payments (
     id TEXT PRIMARY KEY,
     client_id TEXT REFERENCES clients(id),
     membership_id TEXT REFERENCES memberships(id),
     amount REAL NOT NULL,
     method TEXT NOT NULL CHECK (method IN ('efectivo','tarjeta','yapi')),
     day TEXT NOT NULL,
     created_by TEXT REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_payments_day ON payments(day)`,
  `CREATE TABLE IF NOT EXISTS entries (
     id TEXT PRIMARY KEY,
     client_id TEXT NOT NULL REFERENCES clients(id),
     day TEXT NOT NULL,
     check_in_at INTEGER NOT NULL,
     check_out_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_day ON entries(day)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_open ON entries(client_id, check_out_at)`,
  `CREATE TABLE IF NOT EXISTS products (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     price REAL NOT NULL,
     stock INTEGER NOT NULL DEFAULT 0,
     min_stock INTEGER NOT NULL DEFAULT 5,
     active INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS sales (
     id TEXT PRIMARY KEY,
     client_id TEXT REFERENCES clients(id),
     total REAL NOT NULL,
     method TEXT NOT NULL CHECK (method IN ('efectivo','tarjeta','yapi')),
     day TEXT NOT NULL,
     created_by TEXT REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_day ON sales(day)`,
  `CREATE TABLE IF NOT EXISTS sale_items (
     id TEXT PRIMARY KEY,
     sale_id TEXT NOT NULL REFERENCES sales(id),
     product_id TEXT NOT NULL REFERENCES products(id),
     qty INTEGER NOT NULL,
     unit_price REAL NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
     id TEXT PRIMARY KEY,
     product_id TEXT NOT NULL REFERENCES products(id),
     qty INTEGER NOT NULL,
     reason TEXT NOT NULL CHECK (reason IN ('venta','compra','ajuste')),
     day TEXT NOT NULL,
     created_by TEXT REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT
   )`,
];

// Datos iniciales. Los precios son provisionales: confirmar con Ramón.
const SEED_PLANS = [
  ['monthly', 'Membresía Mensual', 79.99, 30],
  ['quarterly', 'Membresía Trimestral', 199.99, 90],
  ['annual', 'Membresía Anual', 599.99, 365],
  ['daily', 'Pago Diario', 15, 1],
];

const SEED_SETTINGS = {
  gym_name: 'Mission Fit Panamá',
  contact_email: 'contacto@missionfit.com',
  phone: '+507 6789-0123',
  whatsapp: '+507 6789-0123',
  currency: 'USD',
};

let ready = null;

export function ensureDb(db) {
  if (!ready) {
    ready = (async () => {
      await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
      await db.batch([
        ...SEED_PLANS.map(([id, name, price, days]) =>
          db.prepare('INSERT OR IGNORE INTO plans (id, name, price, duration_days) VALUES (?, ?, ?, ?)')
            .bind(id, name, price, days)),
        ...Object.entries(SEED_SETTINGS).map(([key, value]) =>
          db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, value)),
      ]);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
