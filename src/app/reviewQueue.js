import { api } from './api';

// Prefixed with /api/skills so a skill mutation invalidates this derived list
// along with the plain skill queries.
export const REVIEW_QUEUE_KEY = '/api/skills#review-queue';

export async function fetchReviewQueue() {
  // One pass over the corpus rather than a query per status: a draft that
  // proposes a revision has to be shown against the skill it revises, and that
  // skill's name is only resolvable with the rest of the list in hand.
  const all = await api('/api/skills');
  const byId = new Map(all.map((s) => [s.id, s]));
  return all
    .filter((s) => s.status === 'draft' || s.status === 'needs_review')
    .map((s) => ({
      ...s,
      supersedes: s.supersedes_skill_id ? byId.get(s.supersedes_skill_id) ?? null : null,
    }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}
