import { useEffect } from 'react';
import PillNav from '../sections/PillNav';
import Footer from '../sections/Footer';
import { posts } from '../blog/posts';
import { setBlogMeta } from '../blog/meta';
import './Blog.css';

export default function Blog() {
  useEffect(() => {
    setBlogMeta({
      title: 'Blog | Brian — Field notes on safe delegation',
      description:
        'Practical writing on giving AI agents your company’s judgment: procedures they follow, lines they don’t cross, and what to do about everything in between.',
      path: '/blog',
    });
  }, []);

  return (
    <div className="blgx">
      <PillNav />
      <main className="blgx-main">
        <header className="blgx-hero">
          <p className="blgx-kicker">The Brian blog</p>
          <h1 className="blgx-title">Field notes on safe delegation</h1>
          <p className="blgx-sub">
            Practical writing on giving AI agents your company’s judgment: procedures they follow,
            lines they don’t cross, and what to do about everything in between.
          </p>
        </header>

        <section className="blgx-grid" aria-label="Articles">
          {posts.map((post) => (
            <a className="blgx-card" href={`/blog/${post.slug}`} key={post.slug}>
              <div className="blgx-card-meta">
                <span className="blgx-card-tag">{post.tag}</span>
                <span className="blgx-card-read">{post.readMinutes} min read</span>
              </div>
              <h2 className="blgx-card-title">{post.title}</h2>
              <p className="blgx-card-desc">{post.description}</p>
              <span className="blgx-card-more">Read the article</span>
            </a>
          ))}
        </section>
      </main>
      <Footer />
    </div>
  );
}
