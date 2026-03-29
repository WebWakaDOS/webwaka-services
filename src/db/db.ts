/**
 * Offline Database — WebWaka Services Suite
 *
 * Invariant 4: Offline First
 * Uses Dexie (IndexedDB wrapper) for client-side offline storage.
 * All data is synced to Cloudflare D1 when connectivity is restored.
 *
 * All monetary amounts stored as kobo integers — Invariant 5: Nigeria First
 */

import Dexie, { type Table } from 'dexie';
import type { Client, Project, Invoice } from '../core/types';

interface MutationQueueEntry {
  id?: number;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: unknown;
  tenantId: string;
  createdAt: string;
  retryCount: number;
}

export class ServicesOfflineDB extends Dexie {
  clients!: Table<Client>;
  projects!: Table<Project>;
  invoices!: Table<Invoice>;
  mutationQueue!: Table<MutationQueueEntry>;

  constructor() {
    super('webwaka-services');
    this.version(1).stores({
      clients: 'id, tenantId, name, email, status',
      projects: 'id, tenantId, clientId, status',
      invoices: 'id, tenantId, projectId, clientId, status',
      mutationQueue: '++id, tenantId, createdAt',
    });
  }
}

export const db = new ServicesOfflineDB();

/**
 * Enqueue a mutation for background sync when offline.
 * All kobo amounts must be integers before enqueueing.
 */
export async function enqueueMutation(
  endpoint: string,
  method: MutationQueueEntry['method'],
  payload: unknown,
  tenantId: string
): Promise<void> {
  await db.mutationQueue.add({
    endpoint,
    method,
    payload,
    tenantId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
}

/**
 * Process the mutation queue when connectivity is restored.
 * Called by the service worker on 'online' event.
 */
export async function processMutationQueue(apiBaseUrl: string, jwtToken: string): Promise<void> {
  const entries = await db.mutationQueue.orderBy('createdAt').toArray();
  for (const entry of entries) {
    try {
      const response = await fetch(`${apiBaseUrl}${entry.endpoint}`, {
        method: entry.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify(entry.payload),
      });
      if (response.ok && entry.id !== undefined) {
        await db.mutationQueue.delete(entry.id);
      } else if (entry.id !== undefined) {
        await db.mutationQueue.update(entry.id, { retryCount: entry.retryCount + 1 });
      }
    } catch {
      if (entry.id !== undefined) {
        await db.mutationQueue.update(entry.id, { retryCount: entry.retryCount + 1 });
      }
    }
  }
}
