import type { getAdminSession } from '../modules/auth/server/auth'

export function createTestAdminSession(): NonNullable<Awaited<ReturnType<typeof getAdminSession>>> {
  const now = new Date('2026-11-17T00:00:00.000Z')
  return {
    session: {
      id: 'test-admin-session', userId: 'test-admin', token: 'test-session-token',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'), createdAt: now, updatedAt: now,
    },
    user: {
      id: 'test-admin', name: 'Admin', email: 'admin@example.test', emailVerified: true,
      createdAt: now, updatedAt: now,
    },
  }
}
