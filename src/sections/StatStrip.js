import Counter from '../components/Counter';
import { useReveal } from '../hooks/useReveal';
import './StatStrip.css';

export default function StatStrip() {
  const ref = useReveal();
  return (
    <section className="stats reveal" ref={ref} aria-label="Key numbers">
      <div className="stats-inner">
        <div className="stat">
          <Counter to={85} suffix="%" />
          <span className="stat-label">top-1 retrieval accuracy</span>
        </div>
        <div className="stat">
          <Counter to={120} />
          <span className="stat-label">skills in the benchmark corpus</span>
        </div>
        <div className="stat">
          <Counter to={9} />
          <span className="stat-label">MCP tools, one server</span>
        </div>
        <div className="stat">
          <Counter to={100} suffix="%" />
          <span className="stat-label">of runs land in the execution log</span>
        </div>
      </div>
    </section>
  );
}
