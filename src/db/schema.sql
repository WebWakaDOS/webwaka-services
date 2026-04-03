-- WebWaka Services Suite — D1 Database Schema
-- Invariant 5: Nigeria First — All amounts in kobo integers

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_tenantId ON clients(tenantId);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  budgetKobo INTEGER NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_tenantId ON projects(tenantId);
CREATE INDEX IF NOT EXISTS idx_projects_clientId ON projects(clientId);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  taxKobo INTEGER NOT NULL,
  totalKobo INTEGER NOT NULL,
  status TEXT NOT NULL,
  dueDate TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenantId ON invoices(tenantId);
CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON invoices(clientId);

-- ─── Appointments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientPhone TEXT NOT NULL,
  clientName TEXT,
  service TEXT NOT NULL,
  scheduledAt TEXT NOT NULL,
  durationMinutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_tenantId ON appointments(tenantId);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(clientPhone);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduledAt ON appointments(scheduledAt);

-- ─── WhatsApp Conversational Sessions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  phone TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'IDLE',
  collectedService TEXT,
  collectedDate TEXT,
  collectedTime TEXT,
  appointmentId TEXT,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_sessions_tenant_phone ON whatsapp_sessions(tenantId, phone);
