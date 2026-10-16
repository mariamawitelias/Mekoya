import { z } from 'zod';

export const checklistBodySchema = z.object({
  description: z.string().trim().min(10, 'Please describe your situation in a little more detail').max(1000),
});

export const checklistModelSchema = z.object({
  matchedServiceId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  alternativeServiceIds: z.array(z.string()).max(3),
  clarifyingQuestion: z.string().trim().max(200).nullable(),
  situationNotes: z.array(z.string().trim().max(200)).max(3),
});

export type ChecklistBody = z.infer<typeof checklistBodySchema>;
export type ChecklistModelOutput = z.infer<typeof checklistModelSchema>;