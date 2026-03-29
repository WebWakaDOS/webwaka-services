import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings } from '../../core/types';

export const projectsRouter = new Hono<{ Bindings: Bindings }>();

projectsRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE tenantId = ? ORDER BY createdAt DESC'
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

projectsRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO projects (id, tenantId, clientId, name, description, status, budgetKobo, startDate, endDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, tenantId, body.clientId, body.name, body.description, body.status || 'draft', body.budgetKobo, body.startDate, body.endDate, createdAt)
    .run();

  return c.json({ success: true, id }, 201);
});
