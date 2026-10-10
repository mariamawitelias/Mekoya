import type { AuthUser } from '../@types/express/index.d.js';

export function canAccessOwnedResource(actor: AuthUser, ownerId: string): boolean {
  return actor.id === ownerId || actor.role === 'SUPER_ADMIN';
}