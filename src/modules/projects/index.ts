/**
 * Projects Module — WebWaka Services Suite
 *
 * Full project lifecycle management: CRUD, task tracking, and milestone management.
 * Tenant isolation is enforced via JWT.
 *
 * Routes:
 *   GET    /api/svc_projects                         — list svc_projects (filter by clientId/status)
 *   POST   /api/svc_projects                         — create project
 *   GET    /api/svc_projects/:id                     — get single project with tasks + milestones
 *   PATCH  /api/svc_projects/:id                     — update project details / status
 *   DELETE /api/svc_projects/:id                     — soft-cancel project
 *
 *   GET    /api/svc_projects/:id/tasks               — list tasks for project
 *   POST   /api/svc_projects/:id/tasks               — create task
 *   PATCH  /api/svc_projects/:id/tasks/:taskId       — update task
 *   DELETE /api/svc_projects/:id/tasks/:taskId       — delete task
 *
 *   GET    /api/svc_projects/:id/milestones          — list milestones
 *   POST   /api/svc_projects/:id/milestones          — create milestone
 *   PATCH  /api/svc_projects/:id/milestones/:mid     — update milestone (mark achieved, etc.)
 *   DELETE /api/svc_projects/:id/milestones/:mid     — delete milestone
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables, ProjectStatus } from '../../core/types';

const VALID_STATUSES: readonly ProjectStatus[] = ['draft', 'active', 'on_hold', 'completed', 'cancelled'];
const VALID_TASK_STATUSES = ['todo', 'in_progress', 'done', 'blocked'] as const;
const VALID_MILESTONE_STATUSES = ['pending', 'achieved', 'missed'] as const;

export const projectsRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

// ─── List Projects ─────────────────────────────────────────────────────────────

projectsRouter.get('/', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const clientId = c.req.query('clientId');
  const status = c.req.query('status');

  let query = 'SELECT * FROM svc_projects WHERE tenantId = ?';
  const bindings: unknown[] = [tenantId];

  if (clientId) { query += ' AND clientId = ?'; bindings.push(clientId); }
  if (status) { query += ' AND status = ?'; bindings.push(status); }

  query += ' ORDER BY createdAt DESC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Get Single Project (with tasks and milestones) ────────────────────────────

projectsRouter.get('/:id', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const project = await c.env.DB.prepare(
    'SELECT * FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();

  if (!project) return c.json({ error: 'Project not found' }, 404);

  const [tasksResult, milestonesResult] = await Promise.all([
    c.env.DB.prepare(
      'SELECT * FROM svc_project_tasks WHERE projectId = ? ORDER BY createdAt ASC',
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      'SELECT * FROM svc_project_milestones WHERE projectId = ? ORDER BY dueDate ASC',
    )
      .bind(id)
      .all(),
  ]);

  return c.json({
    data: {
      ...project,
      tasks: tasksResult.results,
      milestones: milestonesResult.results,
    },
  });
});

// ─── Create Project ────────────────────────────────────────────────────────────

projectsRouter.post('/', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const body = await c.req.json<{
    clientId: string;
    name: string;
    description?: string;
    status?: ProjectStatus;
    budgetKobo: number;
    startDate: string;
    endDate: string;
    tags?: string[];
  }>();

  if (!body.clientId || !body.name || !body.startDate || !body.endDate) {
    return c.json({ error: 'clientId, name, startDate, and endDate are required' }, 400);
  }

  if (!Number.isInteger(body.budgetKobo) || body.budgetKobo < 0) {
    return c.json({ error: 'budgetKobo must be a non-negative integer (kobo)' }, 400);
  }

  const status = body.status ?? 'draft';
  if (!VALID_STATUSES.includes(status)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  // Verify client belongs to tenant
  const clientExists = await c.env.DB.prepare(
    'SELECT id FROM svc_clients WHERE id = ? AND tenantId = ?',
  )
    .bind(body.clientId, tenantId)
    .first();
  if (!clientExists) return c.json({ error: 'Client not found' }, 404);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO svc_projects
       (id, tenantId, clientId, name, description, status, budgetKobo, startDate, endDate, createdAt, updatedAt, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      body.clientId,
      body.name,
      body.description ?? '',
      status,
      body.budgetKobo,
      body.startDate,
      body.endDate,
      now,
      now,
      JSON.stringify(body.tags ?? []),
    )
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Update Project ────────────────────────────────────────────────────────────

projectsRouter.patch('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    status?: ProjectStatus;
    budgetKobo?: number;
    startDate?: string;
    endDate?: string;
    tags?: string[];
  }>();

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }
  if (body.budgetKobo !== undefined && (!Number.isInteger(body.budgetKobo) || body.budgetKobo < 0)) {
    return c.json({ error: 'budgetKobo must be a non-negative integer (kobo)' }, 400);
  }

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name); }
  if (body.description !== undefined) { fields.push('description = ?'); vals.push(body.description); }
  if (body.status !== undefined) { fields.push('status = ?'); vals.push(body.status); }
  if (body.budgetKobo !== undefined) { fields.push('budgetKobo = ?'); vals.push(body.budgetKobo); }
  if (body.startDate !== undefined) { fields.push('startDate = ?'); vals.push(body.startDate); }
  if (body.endDate !== undefined) { fields.push('endDate = ?'); vals.push(body.endDate); }
  if (body.tags !== undefined) { fields.push('tags = ?'); vals.push(JSON.stringify(body.tags)); }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), id, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_projects SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Cancel Project (soft delete) ─────────────────────────────────────────────

projectsRouter.delete('/:id', requireRole(['admin', 'manager']), async (c) => {
  const user = c.get('user');
  const tenantId = user.tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'Project not found' }, 404);

  await c.env.DB.prepare(
    "UPDATE svc_projects SET status = 'cancelled', updatedAt = ? WHERE id = ? AND tenantId = ?",
  )
    .bind(new Date().toISOString(), id, tenantId)
    .run();

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TASK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// ─── List Tasks ───────────────────────────────────────────────────────────────

projectsRouter.get('/:id/tasks', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');

  const project = await c.env.DB.prepare(
    'SELECT id FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(projectId, tenantId)
    .first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const status = c.req.query('status');
  let query = 'SELECT * FROM svc_project_tasks WHERE projectId = ? AND tenantId = ?';
  const bindings: unknown[] = [projectId, tenantId];
  if (status) { query += ' AND status = ?'; bindings.push(status); }
  query += ' ORDER BY createdAt ASC';

  const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json({ data: results });
});

// ─── Create Task ──────────────────────────────────────────────────────────────

projectsRouter.post('/:id/tasks', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');

  const project = await c.env.DB.prepare(
    'SELECT id FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(projectId, tenantId)
    .first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{
    title: string;
    description?: string;
    assignedStaffId?: string;
    dueDate?: string;
    status?: string;
  }>();

  if (!body.title) return c.json({ error: 'title is required' }, 400);

  if (body.assignedStaffId) {
    const staffExists = await c.env.DB.prepare(
      "SELECT id FROM svc_staff WHERE id = ? AND tenantId = ? AND status = 'active'",
    )
      .bind(body.assignedStaffId, tenantId)
      .first();
    if (!staffExists) return c.json({ error: 'Staff member not found or inactive' }, 404);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO svc_project_tasks
       (id, tenantId, projectId, title, description, assignedStaffId, status, dueDate, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      projectId,
      body.title,
      body.description ?? null,
      body.assignedStaffId ?? null,
      body.status ?? 'todo',
      body.dueDate ?? null,
      now,
      now,
    )
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Update Task ──────────────────────────────────────────────────────────────

projectsRouter.patch('/:id/tasks/:taskId', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');
  const taskId = c.req.param('taskId');

  const task = await c.env.DB.prepare(
    'SELECT id FROM svc_project_tasks WHERE id = ? AND projectId = ? AND tenantId = ?',
  )
    .bind(taskId, projectId, tenantId)
    .first();
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const body = await c.req.json<{
    title?: string;
    description?: string;
    assignedStaffId?: string | null;
    status?: string;
    dueDate?: string | null;
  }>();

  if (body.status && !VALID_TASK_STATUSES.includes(body.status as typeof VALID_TASK_STATUSES[number])) {
    return c.json({ error: `status must be one of: ${VALID_TASK_STATUSES.join(', ')}` }, 400);
  }

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.title !== undefined) { fields.push('title = ?'); vals.push(body.title); }
  if (body.description !== undefined) { fields.push('description = ?'); vals.push(body.description); }
  if (body.assignedStaffId !== undefined) { fields.push('assignedStaffId = ?'); vals.push(body.assignedStaffId); }
  if (body.dueDate !== undefined) { fields.push('dueDate = ?'); vals.push(body.dueDate); }
  if (body.status !== undefined) {
    fields.push('status = ?');
    vals.push(body.status);
    if (body.status === 'done') {
      fields.push('completedAt = ?');
      vals.push(new Date().toISOString());
    }
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), taskId, projectId, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_project_tasks SET ${fields.join(', ')} WHERE id = ? AND projectId = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Delete Task ──────────────────────────────────────────────────────────────

projectsRouter.delete('/:id/tasks/:taskId', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');
  const taskId = c.req.param('taskId');

  const task = await c.env.DB.prepare(
    'SELECT id FROM svc_project_tasks WHERE id = ? AND projectId = ? AND tenantId = ?',
  )
    .bind(taskId, projectId, tenantId)
    .first();
  if (!task) return c.json({ error: 'Task not found' }, 404);

  await c.env.DB.prepare('DELETE FROM svc_project_tasks WHERE id = ?').bind(taskId).run();
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MILESTONE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// ─── List Milestones ──────────────────────────────────────────────────────────

projectsRouter.get('/:id/milestones', requireRole(['admin', 'manager', 'consultant']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');

  const project = await c.env.DB.prepare(
    'SELECT id FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(projectId, tenantId)
    .first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM svc_project_milestones WHERE projectId = ? AND tenantId = ? ORDER BY dueDate ASC',
  )
    .bind(projectId, tenantId)
    .all();

  return c.json({ data: results });
});

// ─── Create Milestone ─────────────────────────────────────────────────────────

projectsRouter.post('/:id/milestones', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');

  const project = await c.env.DB.prepare(
    'SELECT id FROM svc_projects WHERE id = ? AND tenantId = ?',
  )
    .bind(projectId, tenantId)
    .first();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{
    name: string;
    description?: string;
    dueDate: string;
    amountKobo?: number;
  }>();

  if (!body.name || !body.dueDate) {
    return c.json({ error: 'name and dueDate are required' }, 400);
  }
  if (body.amountKobo !== undefined && (!Number.isInteger(body.amountKobo) || body.amountKobo < 0)) {
    return c.json({ error: 'amountKobo must be a non-negative integer (kobo)' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO svc_project_milestones
       (id, tenantId, projectId, name, description, dueDate, status, amountKobo, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      projectId,
      body.name,
      body.description ?? null,
      body.dueDate,
      body.amountKobo ?? 0,
      now,
      now,
    )
    .run();

  return c.json({ success: true, id }, 201);
});

// ─── Update Milestone ─────────────────────────────────────────────────────────

projectsRouter.patch('/:id/milestones/:mid', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');
  const mid = c.req.param('mid');

  const milestone = await c.env.DB.prepare(
    'SELECT id FROM svc_project_milestones WHERE id = ? AND projectId = ? AND tenantId = ?',
  )
    .bind(mid, projectId, tenantId)
    .first();
  if (!milestone) return c.json({ error: 'Milestone not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    dueDate?: string;
    status?: string;
    amountKobo?: number;
  }>();

  if (body.status && !VALID_MILESTONE_STATUSES.includes(body.status as typeof VALID_MILESTONE_STATUSES[number])) {
    return c.json({ error: `status must be one of: ${VALID_MILESTONE_STATUSES.join(', ')}` }, 400);
  }

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name); }
  if (body.description !== undefined) { fields.push('description = ?'); vals.push(body.description); }
  if (body.dueDate !== undefined) { fields.push('dueDate = ?'); vals.push(body.dueDate); }
  if (body.amountKobo !== undefined) { fields.push('amountKobo = ?'); vals.push(body.amountKobo); }
  if (body.status !== undefined) {
    fields.push('status = ?');
    vals.push(body.status);
    if (body.status === 'achieved') {
      fields.push('achievedAt = ?');
      vals.push(new Date().toISOString());
    }
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), mid, projectId, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_project_milestones SET ${fields.join(', ')} WHERE id = ? AND projectId = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Delete Milestone ─────────────────────────────────────────────────────────

projectsRouter.delete('/:id/milestones/:mid', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const projectId = c.req.param('id');
  const mid = c.req.param('mid');

  const milestone = await c.env.DB.prepare(
    'SELECT id FROM svc_project_milestones WHERE id = ? AND projectId = ? AND tenantId = ?',
  )
    .bind(mid, projectId, tenantId)
    .first();
  if (!milestone) return c.json({ error: 'Milestone not found' }, 404);

  await c.env.DB.prepare('DELETE FROM svc_project_milestones WHERE id = ?').bind(mid).run();
  return c.json({ success: true });
});
