-- WebWaka Services Suite — Migration 0003
-- Adds: staff, staff_availability, quotes, quote_line_items, deposits, reminder_logs
-- Also extends appointments with staffId, isMobile, location, and depositId columns
-- Invariant 5: Nigeria First — All monetary amounts in kobo integers

-- ─── Staff ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician',
  skills TEXT NOT NULL DEFAULT '[]',       -- JSON-encoded string[]
  status TEXT NOT NULL DEFAULT 'active',
  commissionBps INTEGER NOT NULL DEFAULT 0, -- basis points × 100 (1500 = 15.00%)
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_tenantId ON staff(tenantId);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status);

-- ─── Staff Availability ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_availability (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  dayOfWeek INTEGER NOT NULL, -- 0 (Sunday) – 6 (Saturday)
  startTime TEXT NOT NULL,    -- "HH:MM" WAT
  endTime TEXT NOT NULL,      -- "HH:MM" WAT
  FOREIGN KEY (staffId) REFERENCES staff(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_staff_avail_staffId ON staff_availability(staffId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_avail_unique ON staff_availability(staffId, dayOfWeek);

-- ─── Extend Appointments ──────────────────────────────────────────────────────
-- Add staffId, isMobile (0/1), location coordinates, depositId
-- SQLite ALTER TABLE only supports ADD COLUMN; done one per statement.
ALTER TABLE appointments ADD COLUMN staffId TEXT REFERENCES staff(id);
ALTER TABLE appointments ADD COLUMN isMobile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN locationLat REAL;
ALTER TABLE appointments ADD COLUMN locationLng REAL;
ALTER TABLE appointments ADD COLUMN depositId TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_staffId ON appointments(staffId);

-- ─── Quotes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientId TEXT,
  clientPhone TEXT,
  clientEmail TEXT,
  service TEXT NOT NULL,
  subtotalKobo INTEGER NOT NULL DEFAULT 0,
  taxKobo INTEGER NOT NULL DEFAULT 0,
  totalKobo INTEGER NOT NULL DEFAULT 0,
  depositKobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  validUntil TEXT NOT NULL,
  notes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_tenantId ON quotes(tenantId);
CREATE INDEX IF NOT EXISTS idx_quotes_clientId ON quotes(clientId);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

-- ─── Quote Line Items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_line_items (
  id TEXT PRIMARY KEY,
  quoteId TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unitPriceKobo INTEGER NOT NULL,
  totalKobo INTEGER NOT NULL,
  FOREIGN KEY (quoteId) REFERENCES quotes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quoteId ON quote_line_items(quoteId);

-- ─── Deposits ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appointmentId TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paystackReference TEXT,
  cancellationFeeKobo INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (appointmentId) REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS idx_deposits_tenantId ON deposits(tenantId);
CREATE INDEX IF NOT EXISTS idx_deposits_appointmentId ON deposits(appointmentId);
CREATE INDEX IF NOT EXISTS idx_deposits_paystackRef ON deposits(paystackReference);

-- ─── Reminder Logs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_logs (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appointmentId TEXT NOT NULL,
  channel TEXT NOT NULL,       -- 'sms' | 'whatsapp' | 'email'
  recipient TEXT NOT NULL,     -- phone or email address
  scheduledFor TEXT NOT NULL,  -- ISO datetime UTC
  status TEXT NOT NULL DEFAULT 'scheduled',
  sentAt TEXT,
  errorMessage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (appointmentId) REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS idx_reminders_tenantId ON reminder_logs(tenantId);
CREATE INDEX IF NOT EXISTS idx_reminders_appointmentId ON reminder_logs(appointmentId);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduledFor ON reminder_logs(scheduledFor);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminder_logs(status);
