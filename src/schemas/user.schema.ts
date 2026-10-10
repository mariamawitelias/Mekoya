import { z } from 'zod';
import { emailSchema } from './auth.schema.js';
import { idString, paginationQuerySchema } from './common.schema.js';

const text = (max: number) => z.string().trim().min(1).max(max);

export const createStaffBodySchema = z
  .object({
    email: emailSchema,
    fullName: text(100),
    phone: z.string().trim().regex(/^\+?[0-9\s-]{7,15}$/, 'Invalid phone number').optional(),
    role: z.enum(['OFFICER', 'CONTENT_ADMIN']),
    officeId: idString.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'OFFICER' && !value.officeId) {
      ctx.addIssue({ code: 'custom', path: ['officeId'], message: 'An officer must be assigned to an office' });
    }
    if (value.role !== 'OFFICER' && value.officeId) {
      ctx.addIssue({ code: 'custom', path: ['officeId'], message: 'Only officers are assigned to an office' });
    }
  });

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(['CITIZEN', 'OFFICER', 'CONTENT_ADMIN', 'SUPER_ADMIN']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  search: text(100).optional(),
});

export const setUserStatusBodySchema = z.object({ isActive: z.boolean() });

export const auditQuerySchema = paginationQuerySchema.extend({
  actorId: idString.optional(),
  entityType: text(50).optional(),
  entityId: idString.optional(),
  action: text(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateStaffBody = z.infer<typeof createStaffBodySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type SetUserStatusBody = z.infer<typeof setUserStatusBodySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;