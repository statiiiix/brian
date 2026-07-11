import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const buildDir = path.resolve('build');

function siteUrl() {
  const configured =
    process.env.REACT_APP_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (!configured) return 'http://localhost:3000';
  const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  return withProtocol.replace(/\/$/, '');
}

const origin = siteUrl();
const generatedAt = new Date().toISOString().slice(0, 10);
const indexPath = path.join(buildDir, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');

await writeFile(indexPath, indexHtml.replaceAll('__SITE_URL__', origin));

await writeFile(
  path.join(buildDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${generatedAt}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
);

const robotsPath = path.join(buildDir, 'robots.txt');
const robots = await readFile(robotsPath, 'utf8');
await writeFile(robotsPath, `${robots.trim()}\n\nSitemap: ${origin}/sitemap.xml\n`);

if (origin === 'http://localhost:3000') {
  console.warn('SEO files use http://localhost:3000. Set REACT_APP_SITE_URL to the production origin.');
} else {
  console.log(`Generated canonical and sitemap URLs for ${origin}`);
}
