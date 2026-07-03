import { Icon, icons } from '../components/Icon';
import './Footer.css';

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'The refusal', href: '#refusal' },
      { label: 'Under the hood', href: '#under-the-hood' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Why we’re building this', href: '#manifesto' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Contact', href: 'mailto:a7madinquiries@gmail.com' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-logo">
            <span className="nav-logo-mark" aria-hidden="true">
              <Icon path={icons.bolt} size={13} />
            </span>
            Brian
          </span>
          <p className="footer-tagline">
            The agent does the work.
            <br />
            Brian decides what it's allowed to do.
          </p>
        </div>
        {columns.map((col) => (
          <div className="footer-col" key={col.title}>
            <span className="footer-col-title">{col.title}</span>
            {col.links.map((l) => (
              <a href={l.href} key={l.label}>
                {l.label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>© {new Date().getFullYear()} Brian</span>
          <span>Built on MCP · Postgres · pgvector</span>
        </div>
      </div>
    </footer>
  );
}
