import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const invoicesRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

invoicesRouter.get('/', requireRole(['admin', 'manager', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM invoices WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

invoicesRouter.post('/', requireRole(['admin', 'manager', 'accountant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const invoiceNumber = `INV-${Date.now()}`;

  await c.env.DB.prepare(
    'INSERT INTO invoices (id, tenantId, projectId, clientId, invoiceNumber, amountKobo, taxKobo, totalKobo, status, dueDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.projectId, body.clientId, invoiceNumber, body.amountKobo, body.taxKobo, body.totalKobo, body.status || 'draft', body.dueDate, createdAt)
    .run();

  return c.json({ success: true, id, invoiceNumber }, 201);
});
