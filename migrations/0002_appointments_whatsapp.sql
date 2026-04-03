-- WebWaka Services Suite — Migration 0002
-- Appointments + WhatsApp Conversational Sessions
-- Invariant 5: Nigeria First — WAT (UTC+1) used for display; stored as ISO UTC strings

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  clientPhone TEXT NOT NULL,       -- E.164 WhatsApp phone number (e.g. 2348012345678)
  clientName TEXT,                  -- collected during conversation
  service TEXT NOT NULL,            -- e.g. "Consultation", "Project Review"
  scheduledAt TEXT NOT NULL,        -- ISO 8601 UTC datetime string
  durationMinutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | cancelled | completed
  notes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_tenantId ON appointments(tenantId);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(clientPhone);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduledAt ON appointments(scheduledAt);

-- Conversational state machine sessions (keyed by phone number within a tenant)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id TEXT PRIMARY KEY,             -- composite: tenantId + ':' + phone
  tenantId TEXT NOT NULL,
  phone TEXT NOT NULL,             -- E.164 WhatsApp sender phone
  state TEXT NOT NULL DEFAULT 'IDLE', -- state machine state
  collectedService TEXT,           -- intermediate: chosen service
  collectedDate TEXT,              -- intermediate: parsed date (ISO date string YYYY-MM-DD)
  collectedTime TEXT,              -- intermediate: parsed time (HH:MM, 24h)
  appointmentId TEXT,              -- set when booking is confirmed
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_sessions_tenant_phone ON whatsapp_sessions(tenantId, phone);
