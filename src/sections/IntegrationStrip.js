import { Icon, icons } from '../components/Icon';
import { BrandIcon } from '../components/BrandIcon';
import ProviderLogo from '../app/components/ProviderLogo';
import { useReveal } from '../hooks/useReveal';
import './IntegrationStrip.css';

const sources = [
  { provider: 'google', label: 'Google Workspace' },
  { provider: 'slack', label: 'Slack' },
  { provider: 'notion', label: 'Notion' },
  { provider: 'confluence', label: 'Confluence' },
  { provider: 'sharepoint', label: 'SharePoint' },
  { provider: 'onedrive', label: 'OneDrive' },
  { provider: 'jira', label: 'Jira' },
  { provider: 'linear', label: 'Linear' },
  { provider: 'github', label: 'GitHub' },
  { provider: 'asana', label: 'Asana' },
  { provider: 'clickup', label: 'ClickUp' },
  { provider: 'zendesk', label: 'Zendesk' },
  { provider: 'intercom', label: 'Intercom' },
  { provider: 'hubspot', label: 'HubSpot' },
  { provider: 'salesforce', label: 'Salesforce' },
  { provider: 'gong', label: 'Gong' },
  { provider: 'microsoft_teams', label: 'Microsoft Teams' },
  { provider: 'outlook', label: 'Outlook' },
  { provider: 'zoom', label: 'Zoom' },
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

function Track({ items, reverse, duration }) {
  const half = Array.from({ length: REPEAT }, () => items).flat();
  const loop = half.concat(half);
  return (
    <div className="integ-track-wrap">
      <div
        className={`integ-track ${reverse ? 'integ-track--reverse' : ''}`}
        style={duration ? { '--integ-duration': duration } : undefined}
      >
        {loop.map((it, i) => (
          <span
            className="integ-chip"
            key={i}
            aria-hidden={i >= items.length ? 'true' : undefined}
          >
            {it.provider ? (
              <ProviderLogo provider={it.provider} label={it.label} size={24} />
            ) : it.brand ? (
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
          <Track items={sources} duration="182s" />
        </div>
        <div className="integ-row">
          <span className="integrations-label">Works with</span>
          <Track items={agents} reverse />
        </div>
      </div>
    </section>
  );
}
