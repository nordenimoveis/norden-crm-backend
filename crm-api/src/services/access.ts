import { eq, type SQL } from 'drizzle-orm';
import { leads, type Lead, type UserRole } from '../db/schema.js';
import { forbidden } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  role: UserRole;
  name: string;
}

export const isManager = (u: AuthUser) => u.role === 'DONO' || u.role === 'ADMIN';

/** Regra central de isolamento: corretor só acessa lead atribuído a ele. */
export function assertLeadAccess(user: AuthUser, lead: Pick<Lead, 'brokerId'>) {
  if (isManager(user)) return;
  if (lead.brokerId !== user.id) throw forbidden();
}

/** Filtro SQL para listagens. Gestores veem tudo. */
export function leadScope(user: AuthUser): SQL | undefined {
  return isManager(user) ? undefined : eq(leads.brokerId, user.id);
}
