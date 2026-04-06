-- WebWaka Services Suite — D1 Database Schema
-- Invariant 5: Nigeria First — All amounts in kobo integers

CREATE TABLE IF NOT EXISTS svc_clients (
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
CREATE INDEX IF NOT EXISTS idx_clients_tenantId ON svc_clients(tenantId);

CREATE TABLE IF NOT EXISTS svc_projects (
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
CREATE INDEX IF NOT EXISTS idx_projects_tenantId ON svc_projects(tenantId);
CREATE INDEX IF NOT EXISTS idx_projects_clientId ON svc_projects(clientId);

CREATE TABLE IF NOT EXISTS svc_invoices (
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
CREATE INDEX IF NOT EXISTS idx_invoices_tenantId ON svc_invoices(tenantId);
CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON svc_invoices(clientId);
