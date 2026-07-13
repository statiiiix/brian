import { Icon, msym } from '../components/Icon';
import brianWordmark from '../assets/brian-wordmark.webp';
import './Login.css';

export default function AuthShell({ children, backHref = '/', backLabel = 'Back to site' }) {
  return (
    <div className="login">
      <a href={backHref} className="login-back">
        <Icon path={msym.back} size={16} />
        {backLabel}
      </a>
      <a href="/" className="login-logo">
        <img className="login-logo-wordmark" src={brianWordmark} alt="Brian" />
      </a>
      {children}
    </div>
  );
}
