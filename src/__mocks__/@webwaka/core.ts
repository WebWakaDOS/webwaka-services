/**
 * Local mock of @webwaka/core for vitest testing.
 * Matches @webwaka/core v1.6.1 API surface.
 * In production, the real @webwaka/core package is used.
 *
 * Key invariants mirrored:
 *   - jwtAuthMiddleware() — no-arg, reads JWT_SECRET from c.env internally
 *   - secureCORS()        — no-arg or options-based, reads ENVIRONMENT from c.env
 *   - rateLimit()         — options-based, reads RATE_LIMIT_KV from c.env
 *   - requireRole()       — accepts string[] (not a narrow enum)
 *   - AuthUser            — injected as c.get('user') with userId, email, role, tenantId, permissions
 */

export interface JWTPayload {
  sub: string;
  tenantId: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
  email: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
  permissions: string[];
}

export interface WakaUser {
  id: string;
  tenant_id: string;
  role: string;
  name: string;
  phone: string;
  operator_id: string;
}

export interface JwtAuthOptions {
  publicRoutes?: Array<{ path: string; method?: string }>;
}

export interface SecureCORSOptions {
  allowedOrigins?: string[];
}

export interface RateLimitOptions {
  limit?: number;
  windowSeconds?: number;
  keyPrefix?: string;
  keyExtractor?: (c: unknown) => string;
}

// ─── Default test user injected by jwtAuthMiddleware mock ─────────────────────
const TEST_USER: AuthUser = {
  userId: 'user-test-123',
  email: 'test@webwaka.build',
  role: 'TENANT_ADMIN',
  tenantId: 'tenant-inst-123',
  permissions: ['svc_appointments:read', 'svc_appointments:write', 'svc_invoices:read', 'svc_invoices:write'],
};

// ─── Auth functions ────────────────────────────────────────────────────────────

export async function verifyJWT(_token: string, _secret: string): Promise<JWTPayload | null> {
  return {
    sub: TEST_USER.userId,
    tenantId: TEST_USER.tenantId,
    role: TEST_USER.role,
    permissions: TEST_USER.permissions,
    email: TEST_USER.email,
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  _secret: string,
  _expiresInSeconds?: number,
): Promise<string> {
  return `mock.jwt.${payload.sub}.${payload.tenantId}`;
}

export async function verifyApiKey(
  _rawKey: string,
  _db: unknown,
): Promise<AuthUser | null> {
  return TEST_USER;
}

/**
 * Matches v1.6.1: no-arg (or optional JwtAuthOptions), reads JWT_SECRET from c.env.
 * Injects AuthUser as c.get('user') and tenantId as c.get('tenantId').
 */
export function jwtAuthMiddleware(_options?: JwtAuthOptions) {
  return async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('user', TEST_USER);
    c.set('tenantId', TEST_USER.tenantId);
    await next();
  };
}

/**
 * Matches v1.6.1: accepts string[] roles (not a narrow enum).
 */
export function requireRole(_allowedRoles: string[]) {
  return async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
}

/**
 * Matches v1.6.1: accepts string[] permissions.
 */
export function requirePermissions(_requiredPermissions: string[]) {
  return async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
}

/**
 * Matches v1.6.1: no-arg or options-based, reads ENVIRONMENT from c.env.
 */
export function secureCORS(_options?: SecureCORSOptions) {
  return async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
}

/**
 * Matches v1.6.1: options-based, reads RATE_LIMIT_KV from c.env.
 */
export function rateLimit(_options?: RateLimitOptions) {
  return async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
}

export function getTenantId(_c: unknown): string {
  return TEST_USER.tenantId;
}

export function getAuthUser(_c: unknown): AuthUser {
  return TEST_USER;
}
