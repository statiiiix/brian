import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Icon, icons, msym } from '../../components/Icon';
import { useCachedQuery } from '../useCachedQuery';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './Overview.css';

const GREETINGS = {
  lateNight: [
    'It is past midnight. Brian is still awake. Should he be learning something?',
    'Nobody teaches an agent at 2am for fun. What is the emergency?',
    'Good... night? Brian has no circadian rhythm. What should he learn?',
    'The office is empty. The agent is not. What should Brian learn next?',
    'Teaching Brian at this hour is either dedication or a deadline. Either way, what next?',
    'Everyone else is asleep. Brian is taking notes. Go ahead.',
  ],
  dawn: [
    'Up before the coffee. What should Brian learn next?',
    'Sunrise shift. Brian has been up all night and has no complaints. What next?',
    'Early bird energy. Brian already read the whole backlog. What should he learn?',
    'It is very early. Brian respects that. What should he learn next?',
  ],
  morning: [
    'Good morning. What should Brian learn before the meetings start?',
    'Morning. Brian has had zero coffees and is fine. What should he learn?',
    'Good morning. Brian is caffeinated by API calls. What next?',
    'Morning. Let us teach Brian something before the inbox wakes up.',
    'Good morning. Brian did not check Slack yet. Lucky Brian. What should he learn?',
    'Rise and delegate. What should Brian learn next?',
  ],
  afternoon: [
    'Good afternoon. What should Brian learn between the meetings?',
    'Post-lunch. Brian does not get sleepy. What should he learn?',
    'Afternoon. The productive hours are slipping away. Teach Brian something.',
    'Good afternoon. Brian has no lunch break to protect. What next?',
    'Peak "I will do it later" hour. Give it to Brian instead.',
    'Good afternoon. What is the thing you keep redoing manually?',
  ],
  evening: [
    'Good evening. What should Brian learn next?',
    'Evening. Teach Brian one thing so tomorrow-you can be lazy.',
    'Good evening. Brian does not do overtime pay. What should he learn?',
    'Evening shift. Brian is annoyingly fresh. What next?',
    'Good evening. One more skill and you can close the laptop.',
    'Dinner can wait. Or Brian can handle it. What should he learn?',
  ],
  night: [
    'Good night-ish. What should Brian learn while you sleep?',
    'Late one. Brian never yawns. What should he learn?',
    'The day is done. Brian is not. What next?',
    'Winding down. Hand Brian something to be good at by morning.',
    'Late night skill drop. What should Brian learn?',
  ],
  monday: [
    'It is Monday. Perfect day to make Brian do the boring part.',
    'Monday. Teach Brian something so Friday-you gets a break.',
  ],
  friday: [
    'It is Friday. Teach Brian one thing and go outside.',
    'Friday. Brian works weekends. You do not have to. What should he learn?',
  ],
};

function bucketFor(hour) {
  if (hour < 5) return 'lateNight';
  if (hour < 8) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function greeting(now = new Date()) {
  const pool = [...GREETINGS[bucketFor(now.getHours())]];
  const day = now.getDay();
  if (day === 1) pool.push(...GREETINGS.monday);
  if (day === 5) pool.push(...GREETINGS.friday);
  return pool[Math.floor(Math.random() * pool.length)];
}

function outcomeLabel(outcome) {
  if (outcome === 'completed') return 'Completed';
  if (outcome === 'escalated') return 'Escalated safely';
  if (outcome === 'failed') return 'Failed';
  return 'Logged';
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Overview() {
  const headline = useMemo(() => greeting(), []);

  // Separate queries on purpose: each one shares its cache entry with the page
  // dedicated to that resource, so the dashboard and those pages warm up for
  // one another.
  const skillsQuery = useCachedQuery('/api/skills');
  const executionsQuery = useCachedQuery('/api/executions');
  const connectorsQuery = useCachedQuery('/api/connectors');

  const error = skillsQuery.error || executionsQuery.error || connectorsQuery.error;
  const data = useMemo(() => {
    if (!skillsQuery.data || !executionsQuery.data || !connectorsQuery.data) return null;
    return {
      skills: skillsQuery.data,
      executions: executionsQuery.data,
      connectors: connectorsQuery.data,
    };
  }, [skillsQuery.data, executionsQuery.data, connectorsQuery.data]);

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

  const skillNames = useMemo(() => {
    const map = {};
    for (const s of data?.skills || []) map[s.id] = s.name;
    return map;
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
    return null;
  }, [data, stats]);

  const statTiles = [
    { key: 'active', label: 'Active skills', value: stats.active, to: '/app/skills' },
    { key: 'review', label: 'Needs review', value: stats.review, to: '/app/review', highlight: stats.review > 0 },
    { key: 'runs', label: 'Governed runs', value: stats.runs, to: '/app/executions' },
    { key: 'sources', label: 'Connected sources', value: stats.sources, to: '/app/connectors' },
  ];

  return (
    <div className="overview">
      <header className="dash-head overview-head">
        <div>
          <h1 className="dash-title">{headline}</h1>
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
            {statTiles.map((tile, index) => (
              <Link
                key={tile.key}
                to={tile.to}
                className={`overview-stat ${tile.highlight ? 'overview-stat--review' : ''}`}
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <span className="overview-stat-label">{tile.label}</span>
                <strong>{tile.value}</strong>
                <span className="overview-stat-go" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>

          {nextAction && (
            <div className="overview-main">
              <section className="dash-card overview-next">
                <div className="overview-next-icon"><Icon path={nextAction.icon} size={22} /></div>
                <div className="overview-next-copy">
                  <p className="overview-eyebrow">{nextAction.eyebrow}</p>
                  <h2>{nextAction.title}</h2>
                  <p className="overview-next-body">{nextAction.body}</p>
                  <Link to={nextAction.to} className="dash-btn dash-btn--primary">{nextAction.label}</Link>
                </div>
              </section>
            </div>
          )}

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
                        <td>
                          {execution.skill_id ? (
                            skillNames[execution.skill_id] ? (
                              <Link to={`/app/skills/${execution.skill_id}`}>{skillNames[execution.skill_id]}</Link>
                            ) : (
                              <span className="dash-mono">{execution.skill_id.slice(0, 8)}…</span>
                            )
                          ) : (
                            <span className="overview-unmatched">Unmatched task</span>
                          )}
                        </td>
                        <td className="dash-mono">{execution.skill_version ? `v${execution.skill_version}` : '—'}</td>
                        <td className="dash-mono">{relativeTime(execution.created_at)}</td>
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
