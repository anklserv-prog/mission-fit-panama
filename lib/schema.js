import { newClientCode } from './util.js';
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
  // Libro de movimientos del cliente: cargos (ventas a cuenta) y abonos (pagos de la cuenta).
  `CREATE TABLE IF NOT EXISTS client_ledger (
     id TEXT PRIMARY KEY,
     client_id TEXT NOT NULL REFERENCES clients(id),
     kind TEXT NOT NULL CHECK (kind IN ('cargo','abono')),
     amount REAL NOT NULL,
     method TEXT CHECK (method IS NULL OR method IN ('efectivo','tarjeta','yapi')),
     sale_id TEXT REFERENCES sales(id),
     note TEXT,
     day TEXT NOT NULL,
     created_by TEXT REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_client ON client_ledger(client_id)`,
  // Acceso del socio al portal: contraseña propia (la cédula es el usuario).
  `CREATE TABLE IF NOT EXISTS client_accounts (
     client_id TEXT PRIMARY KEY REFERENCES clients(id),
     password_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     must_change INTEGER NOT NULL DEFAULT 1,
     active INTEGER NOT NULL DEFAULT 1,
     last_login TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS client_sessions (
     token_hash TEXT PRIMARY KEY,
     client_id TEXT NOT NULL REFERENCES clients(id),
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_client_sessions_client ON client_sessions(client_id)`,
  // Claves internas del servidor (firma del QR rotativo). Nunca se devuelven por la API.
  `CREATE TABLE IF NOT EXISTS app_keys (
     name TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  // Bitácora de la recepción: cada ingreso, salida, cierre sin registrar o escaneo rechazado, con usuario y hora.
  `CREATE TABLE IF NOT EXISTS scan_log (
     id TEXT PRIMARY KEY,
     day TEXT NOT NULL,
     at INTEGER NOT NULL,
     user_id TEXT REFERENCES users(id),
     client_id TEXT REFERENCES clients(id),
     action TEXT NOT NULL CHECK (action IN ('ingreso','salida','cerrado','rechazado')),
     reason TEXT,
     entry_id TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_scan_log_day ON scan_log(day)`,
];

// Columnas añadidas después de la primera versión. SQLite no tiene "ADD COLUMN IF NOT EXISTS",
// así que cada sentencia se ejecuta sola y se ignora si la columna ya existe.
const MIGRATIONS = [
  'ALTER TABLE products ADD COLUMN icon TEXT',
  'ALTER TABLE products ADD COLUMN category TEXT',
  // Una venta a cuenta se guarda con on_account = 1: no es ingreso hasta que el cliente abone.
  'ALTER TABLE sales ADD COLUMN on_account INTEGER NOT NULL DEFAULT 0',
  // Código de transacción de Yappy: único en cada tabla (la API también revisa ambas).
  'ALTER TABLE payments ADD COLUMN reference TEXT',
  'ALTER TABLE sales ADD COLUMN reference TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(reference) WHERE reference IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_ref ON sales(reference) WHERE reference IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_payments_ref_search ON payments(reference)',
  // Código interno del cliente: lo que va en el QR (sin datos personales).
  'ALTER TABLE clients ADD COLUMN code TEXT',
  // Veces que se envió la tarjeta por WhatsApp: el cajero solo puede enviarla una vez.
  'ALTER TABLE clients ADD COLUMN card_shares INTEGER NOT NULL DEFAULT 0',
  // Tarjeta abierta para la recepción: se abre en la primera inscripción y se cierra al usarla.
  'ALTER TABLE clients ADD COLUMN card_open INTEGER NOT NULL DEFAULT 0',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_code ON clients(code) WHERE code IS NOT NULL',
  // Intentos fallidos del portal y bloqueo temporal (máximo 3 intentos).
  'ALTER TABLE client_accounts ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE client_accounts ADD COLUMN locked_until INTEGER',
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
  // Horario de atención: vacío hasta que Ramón lo confirme; el portal muestra un texto neutro.
  schedule: '',
  // QR del ingreso: '0' acepta también la tarjeta fija (transición); '1' solo el QR rotativo del portal.
  rotating_qr: '0',
};

let ready = null;

export function ensureDb(db) {
  if (!ready) {
    ready = (async () => {
      await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
      for (const sql of MIGRATIONS) {
        try {
          await db.prepare(sql).run();
        } catch (err) {
          if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
      }
      // Clientes que existían antes del código: se les asigna uno.
      const noCode = await db.prepare('SELECT id FROM clients WHERE code IS NULL').all();
      for (const row of noCode.results) {
        await db.prepare('UPDATE clients SET code = ? WHERE id = ? AND code IS NULL').bind(newClientCode(), row.id).run();
      }
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
