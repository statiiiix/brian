import {
  siAsana,
  siClickup,
  siConfluence,
  siGithub,
  siHubspot,
  siIntercom,
  siJira,
  siLinear,
  siNotion,
  siZendesk,
  siZoom,
} from 'simple-icons';
import {
  mdiGoogle,
  mdiMicrosoftOnedrive,
  mdiMicrosoftOutlook,
  mdiMicrosoftSharepoint,
  mdiMicrosoftTeams,
  mdiSalesforce,
  mdiSlack,
} from '@mdi/js';
import gongLogo from '../../assets/provider-logos/gong.svg';
import './ProviderLogo.css';

// Every mark is bundled with the app. Besides avoiding brittle third-party
// image requests, this ensures CSP/ad blockers cannot make provider icons
// disappear. The Simple Icons entries are the providers' SVG brand marks;
// MDI supplies the Microsoft/Google/Salesforce marks that Simple Icons no
// longer distributes.
const PROVIDERS = {
  google: { path: mdiGoogle, color: '#4285F4' },
  slack: { path: mdiSlack, color: '#4A154B' },
  notion: { icon: siNotion },
  confluence: { icon: siConfluence },
  sharepoint: { path: mdiMicrosoftSharepoint, color: '#036C70' },
  onedrive: { path: mdiMicrosoftOnedrive, color: '#0078D4' },
  jira: { icon: siJira },
  linear: { icon: siLinear },
  github: { icon: siGithub },
  asana: { icon: siAsana },
  clickup: { icon: siClickup },
  zendesk: { icon: siZendesk },
  intercom: { icon: siIntercom },
  hubspot: { icon: siHubspot },
  salesforce: { path: mdiSalesforce, color: '#00A1E0' },
  gong: { image: gongLogo },
  microsoft_teams: { path: mdiMicrosoftTeams, color: '#6264A7' },
  outlook: { path: mdiMicrosoftOutlook, color: '#0078D4' },
  zoom: { icon: siZoom },
};

export default function ProviderLogo({ provider, label, size = 20 }) {
  const logo = PROVIDERS[provider];

  if (!logo) {
    return <span className="provider-logo-fallback" aria-hidden="true">{label?.slice(0, 1)}</span>;
  }

  if (logo.image) {
    return <img className="provider-logo" src={logo.image} width={size} height={size} alt="" aria-hidden="true" />;
  }

  const path = logo.icon?.path || logo.path;
  const color = logo.color || `#${logo.icon.hex}`;
  return (
    <svg
      className="provider-logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`${label || provider} logo`}
      focusable="false"
    >
      <path d={path} fill={color} />
    </svg>
  );
}
