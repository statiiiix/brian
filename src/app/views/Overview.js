import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, icons, msym } from '../../components/Icon';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './Overview.css';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function outcomeLabel(outcome) {
  if (outcome === 'completed') return 'Completed';
  if (outcome === 'escalated') return 'Escalated safely';
  if (outcome === 'failed') return 'Failed';
  return 'Logged';
}

export default function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/api/skills'), api('/api/executions'), api('/api/connectors')])
      .then(([skills, executions, connectors]) => setData({ skills, executions, connectors }))
      .catch((e) => setError(e.message));
  }, []);

  const stats = useMemo(() => {
    const skills = data?.skills || [];
    const executions = data?.executions || [];
    const connectors = data?.connectors || [];
    return {
      active: skills.filter((s) => s.status === 'active').length,
      review: skills.filter((s) => s.status === 'draft' || s.status === 'needs_review').length,
      runs: executions.length,
      sources: connectors.filter((c) => c.status === 'connected').length,
    };
  }, [data]);

  const nextAction = useMemo(() => {
    if (!data) return null;
    if (stats.active === 0) {
      return {
        eyebrow: 'Start with the hard part',
        title: 'Teach Brian one decision your agent should never improvise.',
        body: 'Choose an approval, security, finance, or operations process. Brian will interview the owner about boundaries, evidence, and escalation.',
        to: '/app/build',
        label: 'Build a governed skill',
        icon: icons.shield,
      };
    }
    if (stats.review > 0) {
      return {
        eyebrow: 'Human decision needed',
        title: `${stats.review} skill${stats.review === 1 ? '' : 's'} waiting for review.`,
        body: 'Nothing enters the active brain until someone checks the procedure, hard rules, and stop conditions.',
        to: '/app/review',
        label: 'Open review queue',
        icon: icons.review,
      };
    }
    if (stats.sources === 0) {
      return {
        eyebrow: 'Add operating context',
        title: 'Connect the places where your company makes decisions.',
        body: 'Start with one focused source. Brian extracts evidence and proposes skills; it does not publish raw conversations as policy.',
        to: '/app/connectors',
        label: 'Connect a source',
        icon: icons.database,
      };
    }
    return {
      eyebrow: 'Pressure-test the brain',
      title: 'Try a task where the agent must know when to stop.',
      body: 'Use a high-stakes approval or incident scenario and verify that the agent retrieves the right skill, follows the boundary, and logs the outcome.',
      to: '/app/build',
      label: 'Create another skill',
      icon: icons.escalate,
    };
  }, [data, stats]);

  return (
    <div className="overview">
      <header className="dash-head overview-head">
        <div>
          <h1 className="dash-title">{greeting()}. What should Brian learn next?</h1>
        </div>
        <Link to="/app/build" className="dash-btn dash-btn--primary">
          <Icon path={msym.build} size={16} />
          Build a skill
        </Link>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && data === null && <TableSkeleton rows={4} cols={4} />}

      {data && (
        <>
          <div className="overview-stats" aria-label="Brain status">
            <div className="overview-stat"><span className="overview-stat-label">Active skills</span><strong>{stats.active}</strong></div>
            <div className="overview-stat overview-stat--review"><span className="overview-stat-label">Needs review</span><strong>{stats.review}</strong></div>
            <div className="overview-stat"><span className="overview-stat-label">Governed runs</span><strong>{stats.runs}</strong></div>
            <div className="overview-stat"><span className="overview-stat-label">Connected sources</span><strong>{stats.sources}</strong></div>
          </div>

          <div className="overview-main">
            <section className="dash-card overview-next">
              <div className="overview-next-icon"><Icon path={nextAction.icon} size={22} /></div>
              <div className="overview-next-copy">
                <p className="overview-eyebrow">{nextAction.eyebrow}</p>
                <h2>{nextAction.title}</h2>
                <Link to={nextAction.to} className="dash-btn dash-btn--primary">{nextAction.label}</Link>
              </div>
            </section>
          </div>

          <section className="overview-section">
            <div className="overview-section-head">
              <h2>Recent activity</h2>
              <Link to="/app/executions" className="overview-text-link">View all runs →</Link>
            </div>
            {data.executions.length === 0 ? (
              <div className="dash-card overview-empty-activity"><Icon path={icons.log} size={20} /><span>Your first governed run will appear here — including safe refusals.</span></div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Outcome</th><th>Skill</th><th>Version</th><th>When</th></tr></thead>
                  <tbody>
                    {data.executions.slice(0, 5).map((execution) => (
                      <tr key={execution.id}>
                        <td><StatusBadge status={execution.outcome} /> <span className="overview-outcome-label">{outcomeLabel(execution.outcome)}</span></td>
                        <td className="dash-mono">{execution.skill_id ? `${execution.skill_id.slice(0, 8)}…` : 'Unmatched task'}</td>
                        <td className="dash-mono">{execution.skill_version ? `v${execution.skill_version}` : '—'}</td>
                        <td className="dash-mono">{new Date(execution.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
