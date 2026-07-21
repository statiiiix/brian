import { api } from './api';

// Prefixed with /api/skills so a skill mutation invalidates this derived list
// along with the plain skill queries.
export const REVIEW_QUEUE_KEY = '/api/skills#review-queue';

export async function fetchReviewQueue() {
  const [drafts, needsReview] = await Promise.all([
    api('/api/skills?status=draft'),
    api('/api/skills?status=needs_review'),
  ]);
  return [...drafts, ...needsReview].sort(
    (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
  );
}
