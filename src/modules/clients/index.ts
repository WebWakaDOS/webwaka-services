import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings } from '../../core/types';

export const clientsRouter = new Hono<{ Bindings: Bindings }>();

clientsRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM clients WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

clientsRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO clients (id, tenantId, name, email, phone, company, address, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.name, body.email, body.phone, body.company, body.address, 'active', createdAt, createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});
