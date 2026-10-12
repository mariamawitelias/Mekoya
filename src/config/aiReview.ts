export const AI_REVIEW = {
  autoApproveMinConfidence: 0.85,
  autoRejectMinConfidence: 0.85,
  maxAttempts: 3,
  retryDelaysMs: [0, 1_500, 4_000],
  maxConcurrent: 2,
} as const;