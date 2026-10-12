import { z } from 'zod';
export const documentObservationSchema = z.object({
  documentTypeMatches: z.boolean(),
  detectedDocumentType: z.string().trim().max(100).nullable(),
  isLegible: z.boolean(),
  isComplete: z.boolean(),
  isExpired: z.boolean().nullable(), 
  issues: z.array(z.string().trim().max(200)).max(10),
  confidence: z.number().min(0).max(1),
});

export type DocumentObservation = z.infer<typeof documentObservationSchema>;