import { z } from 'zod';
import { idString, idParamSchema, paginationQuerySchema } from './common.schema';

const text = (max: number) => z.string().trim().min(1).max(max);
const timeSlot = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, for example 08:30');
const atLeastOneField = (value: object) => Object.keys(value).length > 0;

// ── Public queries ──
export const listServicesQuerySchema = paginationQuerySchema.extend({
  search: text(100).optional(),
  category: text(50).optional(),
});

export const listOfficesQuerySchema = z.object({
  city: text(50).optional(),
  serviceId: idString.optional(),
});

// ── Services ──
export const createServiceBodySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers and hyphens'),
  nameEn: text(150),
  nameAm: text(150).optional(),
  descriptionEn: text(2000).optional(),
  descriptionAm: text(2000).optional(),
  category: text(50),
  feeInfo: text(300).optional(),
});

export const updateServiceBodySchema = createServiceBodySchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine(atLeastOneField, 'At least one field is required');

export const linkRequirementBodySchema = z.object({
  isMandatory: z.boolean().default(true),
  notesEn: text(500).optional(),
  notesAm: text(500).optional(),
});

export const serviceRequirementParamsSchema = idParamSchema.extend({ requirementId: idString });

// ── Requirements ──
export const createRequirementBodySchema = z.object({
  nameEn: text(150),
  nameAm: text(150).optional(),
  descriptionEn: text(1000).optional(),
  descriptionAm: text(1000).optional(),
  expectedType: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Use UPPER_SNAKE_CASE'),
});

export const updateRequirementBodySchema = createRequirementBodySchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine(atLeastOneField, 'At least one field is required');

// ── Offices ──
export const createOfficeBodySchema = z.object({
  nameEn: text(150),
  nameAm: text(150).optional(),
  addressEn: text(300).optional(),
  addressAm: text(300).optional(),
  city: text(50),
  slotTimes: z.array(timeSlot).min(1).max(24),
});

export const updateOfficeBodySchema = createOfficeBodySchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine(atLeastOneField, 'At least one field is required');

export const officeServiceBodySchema = z.object({
  slotCapacity: z.number().int().min(1).max(50).default(3),
});

export const officeServiceParamsSchema = idParamSchema.extend({ serviceId: idString });

export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export type ListOfficesQuery = z.infer<typeof listOfficesQuerySchema>;
export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;
export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;
export type LinkRequirementBody = z.infer<typeof linkRequirementBodySchema>;
export type CreateRequirementBody = z.infer<typeof createRequirementBodySchema>;
export type UpdateRequirementBody = z.infer<typeof updateRequirementBodySchema>;
export type CreateOfficeBody = z.infer<typeof createOfficeBodySchema>;
export type UpdateOfficeBody = z.infer<typeof updateOfficeBodySchema>;
export type OfficeServiceBody = z.infer<typeof officeServiceBodySchema>;