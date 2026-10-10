import { z } from 'zod';

export const idString = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid id');

export const idParamSchema = z.object({ id: idString });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});