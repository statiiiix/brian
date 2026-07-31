-- A draft that proposes a revision to an existing skill, rather than a new one.
--
-- Capture already produced these ("proposed_draft": knowledge that matched a
-- live skill but was not safe enough to apply automatically), but nothing
-- recorded which skill was being proposed against — the draft landed in the
-- review queue looking like a fourth near-duplicate of a procedure the company
-- already had. This column carries the link, so activation can apply the draft
-- onto its target instead of adding another skill to the corpus.
--
-- Null for ordinary drafts. Not cascading: skills are retired, not deleted.
alter table skills
  add column if not exists supersedes_skill_id uuid references skills(id);

create index if not exists skills_supersedes_idx
  on skills (supersedes_skill_id)
  where supersedes_skill_id is not null;
