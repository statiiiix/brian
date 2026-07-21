// An interview's `topic` is one column doing two jobs: the first line names the
// process (that's the title people read), and any following lines are the brief
// the interview engine is steered by — risk profile, emphasis, pasted notes.
// Rendering the whole blob as a heading is what made titles run three lines long.

const LEGACY_PREFIX = /^Build a governed Brian skill for:\s*/i;

export function interviewTitle(topic) {
  const [first = ''] = String(topic ?? '').split('\n');
  return first.replace(LEGACY_PREFIX, '').trim() || 'Untitled interview';
}

export function interviewBrief(topic) {
  return String(topic ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
}
