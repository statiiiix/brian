const WIDTHS = ['26%', '14%', '10%', '8%', '12%'];

export default function TableSkeleton({ rows = 5, cols = 5 }) {
  return (
    <div className="dash-skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="dash-skeleton-row">
          {Array.from({ length: cols }).map((_, j) => (
            <span
              key={j}
              className="dash-skeleton-bar"
              style={{ width: WIDTHS[j % WIDTHS.length] }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
