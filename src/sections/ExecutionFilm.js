import LandingFilm from './LandingFilm';

const PUBLIC = process.env.PUBLIC_URL;

export default function ExecutionFilm() {
  return (
    <LandingFilm
      id="execution-film"
      title={<>Your agent should know the job—<em>wherever the work moves.</em></>}
      lede="Brian brings your company’s context, skills, and standards into every environment your agent works in. You stop re-explaining the assignment. The agent picks up with the judgment to move it forward."
      src={`${PUBLIC}/videos/brian-tasks-video.webm`}
      type="video/webm"
      label="A product film showing Brian working with an AI agent across different environments, carrying the right company context and guidance into each task."
      beats={[
        { title: 'Context that follows the work', body: 'Move between environments without rebuilding the brief or reminding the agent how your company operates.' },
        { title: 'Your playbook, right on time', body: 'Brian gives the agent the relevant skills, standards, and constraints at the moment it needs them.' },
        { title: 'Less prompting. More progress.', body: 'The agent starts closer to the answer, works with your company’s judgment, and keeps you in control.' },
      ]}
      dark
    />
  );
}
