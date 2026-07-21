import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { posts } = require('../src/blog/posts.js');

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
const indexHtml = (await readFile(indexPath, 'utf8')).replaceAll('__SITE_URL__', origin);

await writeFile(indexPath, indexHtml);

/* ---------------------------------------------------------------------------
   Blog prerendering.

   The app is client-rendered, so crawlers hitting /blog/* through the SPA
   fallback would see an empty <div id="root">. Instead we emit a static HTML
   snapshot per blog URL (Vercel serves files on disk before applying the
   /index.html rewrite). React then renders the same route over it in the
   browser. Content comes from src/blog/posts.js — the same data the React
   views use — so the snapshot and the app can't drift apart.
--------------------------------------------------------------------------- */

const esc = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const stripTags = (s) => s.replace(/<[^>]+>/g, '');

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function blockHtml(block) {
  switch (block.t) {
    case 'p':
      return `<p class="bpost-p">${block.h}</p>`;
    case 'h2':
      return `<h2 id="${esc(block.id)}" class="bpost-h2">${esc(block.text)}</h2>`;
    case 'h3':
      return `<h3 class="bpost-h3">${esc(block.text)}</h3>`;
    case 'ul':
      return `<ul class="bpost-list">${block.items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    case 'ol':
      return `<ol class="bpost-list bpost-list--ordered">${block.items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
    case 'callout':
      return `<aside class="bpost-callout">${block.h}</aside>`;
    case 'faq':
      return `<section class="bpost-faq" aria-label="Frequently asked questions"><h2 class="bpost-h2">Common questions</h2>${block.items
        .map(
          (i) =>
            `<details class="bpost-faq-item"><summary>${esc(i.q)}</summary><div class="bpost-faq-answer">${i.a}</div></details>`
        )
        .join('')}</section>`;
    default:
      return '';
  }
}

function postArticleHtml(post) {
  const related = (post.related || [])
    .map((s) => posts.find((p) => p.slug === s))
    .filter(Boolean);

  return `<div class="bpost"><main class="bpost-main"><article class="bpost-article"><header class="bpost-header"><nav class="bpost-crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog">Blog</a></nav><div class="bpost-meta"><span class="bpost-tag">${esc(post.tag)}</span><time datetime="${post.datePublished}">${formatDate(post.datePublished)}</time><span>${post.readMinutes} min read</span></div><h1 class="bpost-title">${esc(post.title)}</h1><p class="bpost-lede">${esc(post.description)}</p></header><div class="bpost-body">${post.body
    .map(blockHtml)
    .join('')}</div><aside class="bpost-cta"><h2>${esc(post.cta.title)}</h2><p>${esc(post.cta.body)}</p><a class="bpost-cta-btn" href="${post.cta.href}">${esc(post.cta.label)}</a></aside>${
    related.length
      ? `<section class="bpost-related" aria-label="Related articles"><h2>Keep reading</h2><div class="bpost-related-grid">${related
          .map(
            (r) =>
              `<a class="bpost-related-card" href="/blog/${r.slug}"><span class="bpost-related-tag">${esc(r.tag)}</span><span class="bpost-related-title">${esc(r.title)}</span></a>`
          )
          .join('')}</div></section>`
      : ''
  }</article></main></div>`;
}

function blogIndexHtml() {
  return `<div class="blgx"><main class="blgx-main"><header class="blgx-hero"><p class="blgx-kicker">The Brian blog</p><h1 class="blgx-title">Field notes on safe delegation</h1><p class="blgx-sub">Practical writing on giving AI agents your company’s judgment: procedures they follow, lines they don’t cross, and what to do about everything in between.</p></header><section class="blgx-grid" aria-label="Articles">${posts
    .map(
      (post) =>
        `<a class="blgx-card" href="/blog/${post.slug}"><div class="blgx-card-meta"><span class="blgx-card-tag">${esc(post.tag)}</span><span class="blgx-card-read">${post.readMinutes} min read</span></div><h2 class="blgx-card-title">${esc(post.title)}</h2><p class="blgx-card-desc">${esc(post.description)}</p><span class="blgx-card-more">Read the article</span></a>`
    )
    .join('')}</section></main></div>`;
}

function postSchema(post) {
  const url = `${origin}/blog/${post.slug}`;
  const graph = [
    {
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      headline: post.title,
      description: post.description,
      datePublished: post.datePublished,
      dateModified: post.dateModified,
      url,
      mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'Brian', url: `${origin}/` },
      publisher: { '@id': `${origin}/#organization` },
      image: `${origin}/brian-og.png`,
      inLanguage: 'en',
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${origin}/blog` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
    {
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: 'Brian',
      url: `${origin}/`,
      logo: `${origin}/logo512.png`,
    },
  ];

  const faqBlock = post.body.find((b) => b.t === 'faq');
  if (faqBlock) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faqBlock.items.map((i) => ({
        '@type': 'Question',
        name: i.q,
        acceptedAnswer: { '@type': 'Answer', text: stripTags(i.a) },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

function blogIndexSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Blog',
        '@id': `${origin}/blog#blog`,
        name: 'The Brian blog',
        url: `${origin}/blog`,
        description:
          'Practical writing on giving AI agents your company’s judgment: procedures, guardrails, and escalation.',
        publisher: { '@id': `${origin}/#organization` },
        blogPost: posts.map((p) => ({ '@type': 'BlogPosting', '@id': `${origin}/blog/${p.slug}#article` })),
      },
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: 'Brian',
        url: `${origin}/`,
        logo: `${origin}/logo512.png`,
      },
    ],
  };
}

function transformIndex({ title, description, canonicalPath, ogType, schema, rootHtml }) {
  const url = `${origin}${canonicalPath}`;
  let html = indexHtml;

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${esc(description)}"/>`
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${url}"/>`
  );
  html = html.replace(
    /<meta property="og:type" content="[^"]*"\s*\/?>/,
    `<meta property="og:type" content="${ogType}"/>`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${esc(title)}"/>`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${esc(description)}"/>`
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${url}"/>`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${esc(title)}"/>`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${esc(description)}"/>`
  );
  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">${JSON.stringify(schema)}</script>`
  );
  html = html.replace('<div id="root"></div>', `<div id="root">${rootHtml}</div>`);

  return html;
}

const blogDir = path.join(buildDir, 'blog');
await mkdir(blogDir, { recursive: true });
await writeFile(
  path.join(blogDir, 'index.html'),
  transformIndex({
    title: 'Blog | Brian — Field notes on safe delegation',
    description:
      'Practical writing on giving AI agents your company’s judgment: procedures they follow, lines they don’t cross, and what to do about everything in between.',
    canonicalPath: '/blog',
    ogType: 'website',
    schema: blogIndexSchema(),
    rootHtml: blogIndexHtml(),
  })
);

for (const post of posts) {
  const postDir = path.join(blogDir, post.slug);
  await mkdir(postDir, { recursive: true });
  await writeFile(
    path.join(postDir, 'index.html'),
    transformIndex({
      title: post.seoTitle,
      description: post.description,
      canonicalPath: `/blog/${post.slug}`,
      ogType: 'article',
      schema: postSchema(post),
      rootHtml: postArticleHtml(post),
    })
  );
}

/* ---------------------------------------------------------------------------
   Sitemap + robots
--------------------------------------------------------------------------- */

const urlEntries = [
  { loc: `${origin}/`, lastmod: generatedAt, changefreq: 'weekly', priority: '1.0' },
  { loc: `${origin}/blog`, lastmod: generatedAt, changefreq: 'weekly', priority: '0.8' },
  ...posts.map((p) => ({
    loc: `${origin}/blog/${p.slug}`,
    lastmod: p.dateModified,
    changefreq: 'monthly',
    priority: '0.7',
  })),
];

await writeFile(
  path.join(buildDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
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
console.log(`Prerendered /blog and ${posts.length} blog posts.`);
