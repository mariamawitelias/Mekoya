import type { DocumentStatus } from '@prisma/client';
import { AI_REVIEW } from '../config/aiReview.js';
import type { DocumentObservation } from '../schemas/aiReview.schema.js';

export interface ReviewDecision {
  status: Extract<DocumentStatus, 'AI_APPROVED' | 'AI_REJECTED' | 'NEEDS_HUMAN'>;
  reason: string | null;
}

export function decideReview(observation: DocumentObservation): ReviewDecision {
    const problems: string[] = [];
  if (!observation.isLegible) {
    problems.push('The document is not clearly readable. Please upload a sharper, well-lit scan or photo');
  } else if (!observation.documentTypeMatches) {
    problems.push('This does not look like the requested document');
  }
  if (!observation.isComplete) problems.push('The document appears cut off or incomplete');
  if (observation.isExpired === true) problems.push('The document appears to be expired');

  if (problems.length === 0) {
    return observation.confidence >= AI_REVIEW.autoApproveMinConfidence
      ? { status: 'AI_APPROVED', reason: null }
      : { status: 'NEEDS_HUMAN', reason: null };
  }

  return observation.confidence >= AI_REVIEW.autoRejectMinConfidence
    ? { status: 'AI_REJECTED', reason: `${problems.join('. ')}.` }
    : { status: 'NEEDS_HUMAN', reason: null };
}