import { Icon } from '../../components/Icon';

export default function EmptyState({ icon, title, children, action }) {
  return (
    <div className="dash-empty-state">
      {icon && (
        <span className="dash-empty-icon" aria-hidden="true">
          <Icon path={icon} size={20} />
        </span>
      )}
      <h2 className="dash-empty-title">{title}</h2>
      {children && <p className="dash-empty-desc">{children}</p>}
      {action}
    </div>
  );
}
