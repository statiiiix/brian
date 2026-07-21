// Renders the block vocabulary from src/blog/posts.js as React elements.
// Class names live in src/pages/BlogPost.css (bpost- namespace only).

export default function renderBlocks(blocks) {
  return blocks.map((block, i) => {
    switch (block.t) {
      case 'p':
        return <p key={i} className="bpost-p" dangerouslySetInnerHTML={{ __html: block.h }} />;
      case 'h2':
        return (
          <h2 key={i} id={block.id} className="bpost-h2">
            {block.text}
          </h2>
        );
      case 'h3':
        return (
          <h3 key={i} className="bpost-h3">
            {block.text}
          </h3>
        );
      case 'ul':
        return (
          <ul key={i} className="bpost-list">
            {block.items.map((item, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={i} className="bpost-list bpost-list--ordered">
            {block.items.map((item, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
          </ol>
        );
      case 'callout':
        return <aside key={i} className="bpost-callout" dangerouslySetInnerHTML={{ __html: block.h }} />;
      case 'faq':
        return (
          <section key={i} className="bpost-faq" aria-label="Frequently asked questions">
            <h2 className="bpost-h2">Common questions</h2>
            {block.items.map((item, j) => (
              <details key={j} className="bpost-faq-item">
                <summary>{item.q}</summary>
                <div className="bpost-faq-answer" dangerouslySetInnerHTML={{ __html: item.a }} />
              </details>
            ))}
          </section>
        );
      default:
        return null;
    }
  });
}
