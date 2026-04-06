-- WebWaka Services Suite — D1 Database Schema (Canonical Reference)
-- This file is the cumulative schema reflecting all migrations 0001–0005.
-- For D1 deployment, run migrations in order (wrangler d1 migrations apply).
-- Invariant 5: Nigeria First — All monetary amounts in kobo integers

-- ─── Clients ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_tenantId ON clients(tenantId);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ─── Projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | active | on_hold | completed | cancelled
  budgetKobo INTEGER NOT NULL DEFAULT 0,  -- ALWAYS kobo — Invariant 5
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON-encoded string[]
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_tenantId ON projects(tenantId);
CREATE INDEX IF NOT EXISTS idx_projects_clientId ON projects(clientId);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ─── Project Tasks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignedStaffId TEXT,
  status TEXT NOT NULL DEFAULT 'todo',   -- todo | in_progress | done | blocked
  dueDate TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_tenantId ON project_tasks(tenantId);
CREATE INDEX IF NOT EXISTS idx_project_tasks_projectId ON project_tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);

-- ─── Project Milestones ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_milestones (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  dueDate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | achieved | missed
  amountKobo INTEGER NOT NULL DEFAULT 0,   -- ALWAYS kobo — Invariant 5
  achievedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_milestones_tenantId ON project_milestones(tenantId);
CREATE INDEX IF NOT EXISTS idx_milestones_projectId ON project_milestones(projectId);

-- ─── Invoices ─────────────────────────────────────────────────────────────────
-- projectId is nullable — invoices can exist independently of projects.
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  projectId TEXT,                    -- nullable: optional project association
  clientId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,       -- ALWAYS kobo — Invariant 5
  taxKobo INTEGER NOT NULL DEFAULT 0, -- ALWAYS kobo
  totalKobo INTEGER NOT NULL,        -- ALWAYS kobo
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | paid | overdue | cancelled
  dueDate TEXT NOT NULL,
  notes TEXT,
  paidAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenantId ON invoices(tenantId);
CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON invoices(clientId);
CREATE INDEX IF NOT EXISTS idx_invoices_projectId ON invoices(projectId);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- ─── Appointments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientPhone TEXT NOT NULL,         -- E.164 WhatsApp phone number (e.g. 2348012345678)
  clientName TEXT,                   -- collected during conversation
  clientId TEXT,                     -- optional: link to clients table (migration 0004)
  service TEXT NOT NULL,             -- e.g. "Consultation", "Project Review"
  scheduledAt TEXT NOT NULL,         -- ISO 8601 UTC datetime string
  durationMinutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | cancelled | completed
  notes TEXT,
  staffId TEXT REFERENCES staff(id),
  isMobile INTEGER NOT NULL DEFAULT 0,   -- 0|1 SQLite boolean
  locationLat REAL,
  locationLng REAL,
  depositId TEXT,
  calendarEventId TEXT,              -- external calendar event ID for bidirectional sync (WW-SVC-001)
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_tenantId ON appointments(tenantId);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(clientPhone);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduledAt ON appointments(scheduledAt);
CREATE INDEX IF NOT EXISTS idx_appointments_staffId ON appointments(staffId);
CREATE INDEX IF NOT EXISTS idx_appointments_clientId ON appointments(clientId);
CREATE INDEX IF NOT EXISTS idx_appointments_calendarEventId ON appointments(calendarEventId);

-- ─── WhatsApp Conversational Sessions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id TEXT PRIMARY KEY,               -- composite: tenantId + ':' + phone
  tenantId TEXT NOT NULL,
  phone TEXT NOT NULL,               -- E.164 WhatsApp sender phone
  state TEXT NOT NULL DEFAULT 'IDLE', -- state machine state
  collectedService TEXT,             -- intermediate: chosen service
  collectedDate TEXT,                -- intermediate: parsed date (ISO date string YYYY-MM-DD)
  collectedTime TEXT,                -- intermediate: parsed time (HH:MM, 24h)
  appointmentId TEXT,                -- set when booking is confirmed
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_sessions_tenant_phone ON whatsapp_sessions(tenantId, phone);

-- ─── Staff ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician',
  skills TEXT NOT NULL DEFAULT '[]',        -- JSON-encoded string[]
  status TEXT NOT NULL DEFAULT 'active',    -- active | inactive
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

-- ─── Quotes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientId TEXT,
  clientPhone TEXT,
  clientEmail TEXT,
  service TEXT NOT NULL,
  subtotalKobo INTEGER NOT NULL DEFAULT 0,   -- ALWAYS kobo
  taxKobo INTEGER NOT NULL DEFAULT 0,        -- ALWAYS kobo
  totalKobo INTEGER NOT NULL DEFAULT 0,      -- ALWAYS kobo
  depositKobo INTEGER NOT NULL DEFAULT 0,    -- required deposit amount in kobo
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | sent | accepted | rejected | expired
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
  unitPriceKobo INTEGER NOT NULL,     -- ALWAYS kobo
  totalKobo INTEGER NOT NULL,         -- quantity × unitPriceKobo
  FOREIGN KEY (quoteId) REFERENCES quotes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quoteId ON quote_line_items(quoteId);

-- ─── Deposits ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  appointmentId TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,              -- ALWAYS kobo
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | refunded | forfeited
  paystackReference TEXT,
  cancellationFeeKobo INTEGER NOT NULL DEFAULT 0,  -- ALWAYS kobo
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
  channel TEXT NOT NULL,                -- sms | whatsapp | email
  recipient TEXT NOT NULL,              -- phone or email address
  scheduledFor TEXT NOT NULL,           -- ISO datetime UTC
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | sent | failed | cancelled
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

-- ─── Services Catalog ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  durationMinutes INTEGER NOT NULL DEFAULT 30,
  basePriceKobo INTEGER NOT NULL DEFAULT 0,  -- ALWAYS kobo — Invariant 5
  isActive INTEGER NOT NULL DEFAULT 1,        -- 0 | 1 (SQLite boolean)
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_tenantId ON services(tenantId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_tenant_name ON services(tenantId, name);

-- ─── API Keys (External Booking Authentication — WW-SVC-008) ──────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  label TEXT NOT NULL,              -- human-readable label
  keyHashSha256 TEXT NOT NULL,      -- SHA-256 hex — NEVER store plaintext
  scopes TEXT NOT NULL DEFAULT 'bookings:read,bookings:write',
  isActive INTEGER NOT NULL DEFAULT 1,  -- 0 | 1 (SQLite boolean)
  lastUsedAt TEXT,
  expiresAt TEXT,                   -- NULL = never expires
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenantId ON api_keys(tenantId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(keyHashSha256);
