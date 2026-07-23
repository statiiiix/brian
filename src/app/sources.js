// Every source the server can ground an interview in. `logo` is the
// ProviderLogo key, which differs from the connector type for the Google apps.
// Shared by the Build-a-skill setup page and the in-interview source picker so
// both offer the same set from one registry.
export const SOURCES = {
  notion: { label: 'Notion', logo: 'notion', hint: 'SOPs and team wikis' },
  confluence: { label: 'Confluence', logo: 'confluence', hint: 'Policies and runbooks' },
  sharepoint: { label: 'SharePoint', logo: 'sharepoint', hint: 'Controlled files' },
  onedrive: { label: 'OneDrive', logo: 'onedrive', hint: 'Working documents' },
  google_drive: { label: 'Google Drive', logo: 'google', hint: 'Docs and playbooks' },
  gmail: { label: 'Gmail', logo: 'google', hint: 'Threads and approvals' },
  outlook: { label: 'Outlook', logo: 'outlook', hint: 'Threads and approvals' },
  slack: { label: 'Slack', logo: 'slack', hint: 'Channel decisions' },
  microsoft_teams: { label: 'Microsoft Teams', logo: 'microsoft_teams', hint: 'Channel decisions' },
  jira: { label: 'Jira', logo: 'jira', hint: 'Tickets and incidents' },
  linear: { label: 'Linear', logo: 'linear', hint: 'Issues and triage' },
  github: { label: 'GitHub', logo: 'github', hint: 'Reviews and runbooks' },
  asana: { label: 'Asana', logo: 'asana', hint: 'Tasks and approvals' },
  clickup: { label: 'ClickUp', logo: 'clickup', hint: 'Operational checklists' },
  zendesk: { label: 'Zendesk', logo: 'zendesk', hint: 'Resolved tickets' },
  intercom: { label: 'Intercom', logo: 'intercom', hint: 'Customer conversations' },
  hubspot: { label: 'HubSpot', logo: 'hubspot', hint: 'Deals and handoffs' },
  salesforce: { label: 'Salesforce', logo: 'salesforce', hint: 'Cases and approvals' },
  gong: { label: 'Gong', logo: 'gong', hint: 'Calls and objections' },
  zoom: { label: 'Zoom', logo: 'zoom', hint: 'Recorded walkthroughs' },
};

export const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp';
export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;

// Turn the server's terse attach errors into a sentence the expert can act on.
export function sourceError(message) {
  if (message === 'selection_required') {
    return 'That source has no content selected yet — choose what Brian may read on the Connectors page.';
  }
  if (message === 'source_not_connected') return 'That source is no longer connected.';
  if (message === 'source content unavailable') return 'That source could not be read just now. Try again.';
  return message;
}
