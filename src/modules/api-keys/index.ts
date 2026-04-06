/**
 * API Keys Admin Module — WebWaka Services Suite
 *
 * WW-SVC-008: Allows tenant admins to create, list, and revoke API keys for
 * external booking platform integrations. The plaintext key is shown ONCE
 * at creation time; thereafter only a truncated hint is stored.
 *
 * Routes:
 *   GET    /api/api-keys           — list keys for the tenant
 *   POST   /api/api-keys           — create a new key (returns plaintext once)
 *   PATCH  /api/api-keys/:id       — update label or scopes
 *   DELETE /api/api-keys/:id       — revoke (deactivate) a key
 *
 * Security:
 *   - Plaintext key is NEVER stored; only SHA-256 hash is persisted.
 *   - Scopes are comma-separated strings (e.g. "bookings:read,bookings:write").
 *   - Only 'admin' role may manage API keys.
 */

import { Hono } from 'hono';
import { requireRole } from '@webwaka/core';
import type { Bindings, AppVariables } from '../../core/types';

export const apiKeysRouter = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();

const VALID_SCOPES = ['bookings:read', 'bookings:write'];

async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate a cryptographically random API key — format: ww_<64 hex chars> */
function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `ww_${hex}`;
}

// ─── List API Keys ─────────────────────────────────────────────────────────────

apiKeysRouter.get('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;

  const { results } = await c.env.DB.prepare(
    `SELECT id, label, scopes, isActive, lastUsedAt, expiresAt, createdAt, updatedAt
     FROM svc_api_keys
     WHERE tenantId = ?
     ORDER BY createdAt DESC`,
  )
    .bind(tenantId)
    .all();

  return c.json({ data: results });
});

// ─── Create API Key ────────────────────────────────────────────────────────────
// The plaintext key is returned only once. Store it securely.

apiKeysRouter.post('/', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;

  const body = await c.req.json<{
    label: string;
    scopes: string[];
    expiresAt?: string;
  }>();

  if (!body.label) return c.json({ error: 'label is required' }, 400);

  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return c.json({ error: 'scopes must be a non-empty array' }, 400);
  }

  const invalidScopes = body.scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    return c.json({
      error: `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`,
    }, 400);
  }

  if (body.expiresAt && isNaN(Date.parse(body.expiresAt))) {
    return c.json({ error: 'expiresAt must be a valid ISO 8601 datetime' }, 400);
  }

  // Generate key and hash it immediately — plaintext is discarded after response
  const plaintext = generateApiKey();
  const hash = await sha256Hex(plaintext);
  const scopeString = [...new Set(body.scopes)].join(',');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO svc_api_keys
       (id, tenantId, label, keyHashSha256, scopes, isActive, lastUsedAt, expiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
  )
    .bind(id, tenantId, body.label, hash, scopeString, body.expiresAt ?? null, now, now)
    .run();

  return c.json({
    success: true,
    id,
    label: body.label,
    scopes: body.scopes,
    expiresAt: body.expiresAt ?? null,
    // Return plaintext ONCE — store it now; it cannot be recovered
    apiKey: plaintext,
    warning: 'This API key is shown only once. Copy it to a secure location immediately.',
  }, 201);
});

// ─── Update API Key (label, scopes, isActive) ─────────────────────────────────

apiKeysRouter.patch('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM svc_api_keys WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'API key not found' }, 404);

  const body = await c.req.json<{ label?: string; scopes?: string[]; isActive?: boolean }>();

  if (body.scopes !== undefined) {
    const invalidScopes = body.scopes.filter((s) => !VALID_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      return c.json({
        error: `Invalid scopes: ${invalidScopes.join(', ')}. Valid: ${VALID_SCOPES.join(', ')}`,
      }, 400);
    }
  }

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (body.label !== undefined) { fields.push('label = ?'); vals.push(body.label); }
  if (body.scopes !== undefined) { fields.push('scopes = ?'); vals.push([...new Set(body.scopes)].join(',')); }
  if (body.isActive !== undefined) { fields.push('isActive = ?'); vals.push(body.isActive ? 1 : 0); }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);

  fields.push('updatedAt = ?');
  vals.push(new Date().toISOString(), id, tenantId);

  await c.env.DB.prepare(
    `UPDATE svc_api_keys SET ${fields.join(', ')} WHERE id = ? AND tenantId = ?`,
  )
    .bind(...vals)
    .run();

  return c.json({ success: true });
});

// ─── Revoke API Key ────────────────────────────────────────────────────────────

apiKeysRouter.delete('/:id', requireRole(['admin']), async (c) => {
  const tenantId = c.get('user').tenantId;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM svc_api_keys WHERE id = ? AND tenantId = ?',
  )
    .bind(id, tenantId)
    .first();
  if (!existing) return c.json({ error: 'API key not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE svc_api_keys SET isActive = 0, updatedAt = ? WHERE id = ? AND tenantId = ?',
  )
    .bind(new Date().toISOString(), id, tenantId)
    .run();

  return c.json({ success: true });
});
