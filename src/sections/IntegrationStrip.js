import { Icon, icons } from '../components/Icon';
import { BrandIcon } from '../components/BrandIcon';
import { useReveal } from '../hooks/useReveal';
import './IntegrationStrip.css';

const sources = [
  { brand: 'slack', label: 'Slack' },
  { brand: 'gmail', label: 'Gmail' },
  { icon: icons.ticket, label: 'Support tickets' },
  { icon: icons.docs, label: 'Google Drive + docs' },
  { icon: icons.database, label: 'Your database' },
];

const agents = [
  { brand: 'claude', label: 'Claude' },
  { brand: 'chatgpt', label: 'ChatGPT' },
  { brand: 'cursor', label: 'Cursor' },
  { brand: 'codex', label: 'Codex' },
  { brand: 'openclaw', label: 'OpenClaw AI' },
  { brand: 'hermes', label: 'Hermes Agent' },
  { icon: icons.rules, label: 'Your own agent · MCP' },
];

// Repeat the set enough that a single half always overflows the strip, so the
// -50% translate lands on an identical frame and the loop never shows a gap.
const REPEAT = 4;

function Track({ items, reverse }) {
  const half = Array.from({ length: REPEAT }, () => items).flat();
  const loop = half.concat(half);
  return (
    <div className="integ-track-wrap">
      <div className={`integ-track ${reverse ? 'integ-track--reverse' : ''}`}>
        {loop.map((it, i) => (
          <span
            className="integ-chip"
            key={i}
            aria-hidden={i >= items.length ? 'true' : undefined}
          >
            {it.brand ? (
              <BrandIcon name={it.brand} size={24} />
            ) : (
              <Icon path={it.icon} size={22} />
            )}
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function IntegrationStrip() {
  const ref = useReveal();
  return (
    <section
      className="integrations reveal"
      ref={ref}
      aria-label="Where Brian pulls knowledge from, and which agents it works with"
    >
      <div className="integrations-inner">
        <div className="integ-row">
          <span className="integrations-label">Pulls knowledge from</span>
          <Track items={sources} />
        </div>
        <div className="integ-row">
          <span className="integrations-label">Works with</span>
          <Track items={agents} reverse />
        </div>
      </div>
    </section>
  );
}
