import { useReveal } from '../hooks/useReveal';
import './IntegrationStrip.css';

const agents = [
  'Claude Desktop',
  'Claude Code',
  'Cursor',
  'Your own agent · Streamable HTTP',
];

export default function IntegrationStrip() {
  const ref = useReveal();
  return (
    <section className="integrations reveal" ref={ref} aria-label="Compatible agents">
      <div className="integrations-inner">
        <span className="integrations-label">
          Works with any MCP-capable agent
        </span>
        <div className="integrations-list">
          {agents.map((a) => (
            <span className="integrations-item" key={a}>
              {a}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
