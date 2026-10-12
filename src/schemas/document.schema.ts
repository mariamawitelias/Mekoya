import { z } from 'zod';
import { idString, paginationQuerySchema } from './common.schema.js';

export const uploadDocumentBodySchema = z.object({ serviceRequirementId: idString });
export type UploadDocumentBody = z.infer<typeof uploadDocumentBodySchema>;
export const reviewDocumentBodySchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECT' && !value.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required when rejecting a document' });
    }
  });

export const officerDocumentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['NEEDS_HUMAN', 'PENDING', 'AI_APPROVED', 'AI_REJECTED']).optional(),
});

export type ReviewDocumentBody = z.infer<typeof reviewDocumentBodySchema>;
export type OfficerDocumentsQuery = z.infer<typeof officerDocumentsQuerySchema>;