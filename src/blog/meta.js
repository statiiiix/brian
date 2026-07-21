// Client-side head management for blog routes. The prerendered HTML that
// crawlers receive is generated at build time in scripts/generate-seo.mjs;
// this keeps the head correct after client-side rendering takes over.

export function setBlogMeta({ title, description, path }) {
  document.title = title;

  let desc = document.querySelector('meta[name="description"]');
  if (!desc) {
    desc = document.createElement('meta');
    desc.setAttribute('name', 'description');
    document.head.appendChild(desc);
  }
  desc.setAttribute('content', description);

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', `${window.location.origin}${path}`);
}
