-- WebWaka Services Suite — Migration 0005
-- Fix: invoices.projectId must be nullable (invoices can exist without a project)
-- The original migration 0001 defined projectId as NOT NULL which conflicts
-- with the Invoice TypeScript type (projectId: string | null) and the module
-- code which stores NULL when no project is associated.
--
-- SQLite does not support DROP COLUMN or ALTER COLUMN — we must recreate the table.
-- This migration copies all data to a new table with the corrected schema.
-- Invariant 5: Nigeria First — All monetary amounts in kobo integers

-- Step 1: Create the corrected invoices table with nullable projectId
CREATE TABLE IF NOT EXISTS invoices_new (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  projectId TEXT,                    -- nullable: invoices can exist without a project
  clientId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL,
  amountKobo INTEGER NOT NULL,
  taxKobo INTEGER NOT NULL DEFAULT 0,
  totalKobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  dueDate TEXT NOT NULL,
  notes TEXT,
  paidAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);

-- Step 2: Copy all existing data (migration 0004 already added updatedAt/notes/paidAt)
INSERT INTO invoices_new (id, tenantId, projectId, clientId, invoiceNumber,
  amountKobo, taxKobo, totalKobo, status, dueDate, notes, paidAt, createdAt, updatedAt)
SELECT id, tenantId,
  CASE WHEN projectId = '' THEN NULL ELSE projectId END,
  clientId, invoiceNumber,
  amountKobo, taxKobo, totalKobo, status, dueDate,
  notes, paidAt, createdAt, updatedAt
FROM invoices;

-- Step 3: Drop old table and rename new one
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_invoices_tenantId ON invoices(tenantId);
CREATE INDEX IF NOT EXISTS idx_invoices_clientId ON invoices(clientId);
CREATE INDEX IF NOT EXISTS idx_invoices_projectId ON invoices(projectId);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
