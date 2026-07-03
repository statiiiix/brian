import './StatusBadge.css';

const LABELS = {
  draft: 'Draft',
  active: 'Active',
  needs_review: 'Needs review',
  retired: 'Retired',
  ready: 'Ready',
  completed: 'Completed',
  abandoned: 'Abandoned',
  escalated: 'Escalated',
  failed: 'Failed',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge-dot" aria-hidden="true" />
      {LABELS[status] || status}
    </span>
  );
}
