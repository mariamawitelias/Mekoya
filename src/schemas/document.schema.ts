import { z } from 'zod';
import { idString } from './common.schema.js';

export const uploadDocumentBodySchema = z.object({ serviceRequirementId: idString });
export type UploadDocumentBody = z.infer<typeof uploadDocumentBodySchema>;