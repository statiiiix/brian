import { useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import PillNav from '../sections/PillNav';
import Footer from '../sections/Footer';
import { posts } from '../blog/posts';
import renderBlocks from '../blog/renderBlocks';
import { setBlogMeta } from '../blog/meta';
import './BlogPost.css';

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = posts.find((p) => p.slug === slug);

  useEffect(() => {
    if (!post) return;
    setBlogMeta({
      title: post.seoTitle,
      description: post.description,
      path: `/blog/${post.slug}`,
    });
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  const related = (post.related || [])
    .map((s) => posts.find((p) => p.slug === s))
    .filter(Boolean);

  return (
    <div className="bpost">
      <PillNav />
      <main className="bpost-main">
        <article className="bpost-article">
          <header className="bpost-header">
            <nav className="bpost-crumbs" aria-label="Breadcrumb">
              <a href="/">Home</a>
              <span aria-hidden="true">/</span>
              <a href="/blog">Blog</a>
            </nav>
            <div className="bpost-meta">
              <span className="bpost-tag">{post.tag}</span>
              <time dateTime={post.datePublished}>{formatDate(post.datePublished)}</time>
              <span>{post.readMinutes} min read</span>
            </div>
            <h1 className="bpost-title">{post.title}</h1>
            <p className="bpost-lede">{post.description}</p>
          </header>

          <div className="bpost-body">{renderBlocks(post.body)}</div>

          <aside className="bpost-cta">
            <h2>{post.cta.title}</h2>
            <p>{post.cta.body}</p>
            <a className="bpost-cta-btn" href={post.cta.href}>
              {post.cta.label}
            </a>
          </aside>

          {related.length > 0 && (
            <section className="bpost-related" aria-label="Related articles">
              <h2>Keep reading</h2>
              <div className="bpost-related-grid">
                {related.map((r) => (
                  <a className="bpost-related-card" href={`/blog/${r.slug}`} key={r.slug}>
                    <span className="bpost-related-tag">{r.tag}</span>
                    <span className="bpost-related-title">{r.title}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>
      <Footer />
    </div>
  );
}
