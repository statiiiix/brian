import LandingFilm from './LandingFilm';

const PUBLIC = process.env.PUBLIC_URL;

export default function SkillCreationFilm() {
  return (
    <LandingFilm
      id="skill-film"
      title={<>Brian learns how your company <em>actually operates.</em></>}
      lede="It reads the signals already scattered across your systems, removes the noise, and turns repeated judgment into a skill a human can review before it goes live."
      src={`${PUBLIC}/videos/brian-connect-video.webm`}
      type="video/webm"
      label="A product film showing Brian syncing Slack, Gmail, support tickets, Google Drive documents, and database telemetry, clustering evidence into a production release approval skill, and sending it through human review before activation."
      beats={[
        { title: 'Connect the evidence', body: 'Brian connects the tools your team relies on and keeps every signal tied to its source—so critical context never gets lost.' },
        { title: 'Find the operating truth', body: 'Brian filters noise and clusters repeated decisions, constraints, and edge cases.' },
        { title: 'Review before it runs', body: 'A person approves the procedure, guardrails, ownership, and source trail.' },
      ]}
      orange
    />
  );
}
