-- WebWaka Services Suite — Migration 0004
-- Adds: calendarEventId to appointments, project_tasks, project_milestones,
--       services catalog, api_keys (for external booking API authentication)
-- Invariant 5: Nigeria First — All monetary amounts in kobo integers

-- ─── Calendar Event ID on Appointments ───────────────────────────────────────
-- Stores the external calendar event ID (e.g. Google Calendar event ID or iCal UID)
-- for bidirectional sync with external calendars.
ALTER TABLE appointments ADD COLUMN calendarEventId TEXT;
ALTER TABLE appointments ADD COLUMN clientId TEXT;
CREATE INDEX IF NOT EXISTS idx_appointments_clientId ON appointments(clientId);
CREATE INDEX IF NOT EXISTS idx_appointments_calendarEventId ON appointments(calendarEventId);

-- ─── Project Tasks ────────────────────────────────────────────────────────────
-- Sub-tasks within a project, assigned to staff members.
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
-- Key delivery milestones within a project with payment tracking.
CREATE TABLE IF NOT EXISTS project_milestones (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  dueDate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | achieved | missed
  amountKobo INTEGER NOT NULL DEFAULT 0,   -- payment milestone amount in kobo
  achievedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_milestones_tenantId ON project_milestones(tenantId);
CREATE INDEX IF NOT EXISTS idx_milestones_projectId ON project_milestones(projectId);

-- ─── Services Catalog ─────────────────────────────────────────────────────────
-- Tenant-specific service definitions: name, duration, base price.
-- Consumed by the external booking API and scheduling engine.
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

-- ─── API Keys (External Booking Authentication) ───────────────────────────────
-- API keys issued to external partners for the /external/* booking API.
-- Scoped to a tenant; never expose secret in plaintext — store hashed SHA-256.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  label TEXT NOT NULL,          -- human-readable label for the key
  keyHashSha256 TEXT NOT NULL,  -- SHA-256 hex of the raw API key (never store plaintext)
  scopes TEXT NOT NULL DEFAULT 'bookings:read,bookings:write',  -- comma-separated
  isActive INTEGER NOT NULL DEFAULT 1,  -- 0 = revoked
  lastUsedAt TEXT,
  expiresAt TEXT,               -- NULL = never expires
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenantId ON api_keys(tenantId);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(keyHashSha256);

-- ─── Invoices updatedAt (missing from initial schema) ─────────────────────────
ALTER TABLE invoices ADD COLUMN updatedAt TEXT;
ALTER TABLE invoices ADD COLUMN notes TEXT;
ALTER TABLE invoices ADD COLUMN paidAt TEXT;

-- ─── Projects updatedAt (missing from initial schema) ─────────────────────────
ALTER TABLE projects ADD COLUMN updatedAt TEXT;
ALTER TABLE projects ADD COLUMN tags TEXT;   -- JSON-encoded string[]
