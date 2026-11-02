import type { ReactNode } from 'react';
import { isSafeHref, type BlockNode, type InlineNode, type RichDoc } from '@secure-sections/shared';

/**
 * Renders validated RichDoc JSON to React elements. There is no HTML parsing and no
 * dangerouslySetInnerHTML anywhere: text is always rendered as text nodes, and link hrefs are
 * re-checked here even though the server already validated them (defence in depth).
 */
export function RichRenderer({ doc }: { doc: RichDoc }) {
  return <div className="ss-prose">{doc.content.map((b, i) => block(b, i))}</div>;
}

function inline(n: InlineNode, key: number): ReactNode {
  if (n.type === 'hardBreak') return <br key={key} />;
  let el: ReactNode = n.text;
  for (const m of n.marks ?? []) {
    switch (m.type) {
      case 'bold':
        el = <strong>{el}</strong>;
        break;
      case 'italic':
        el = <em>{el}</em>;
        break;
      case 'strike':
        el = <s>{el}</s>;
        break;
      case 'code':
        el = <code>{el}</code>;
        break;
      case 'link':
        el = isSafeHref(m.attrs.href) ? (
          <a href={m.attrs.href} target="_blank" rel="noopener noreferrer nofollow">
            {el}
          </a>
        ) : (
          el
        );
        break;
    }
  }
  return <span key={key}>{el}</span>;
}

function children(nodes: BlockNode[]): ReactNode[] {
  return nodes.map((c, i) => block(c, i));
}

function block(n: BlockNode, key: number): ReactNode {
  switch (n.type) {
    case 'paragraph':
      return <p key={key}>{(n.content ?? []).map((c, i) => inline(c, i))}</p>;
    case 'heading': {
      const content = (n.content ?? []).map((c, i) => inline(c, i));
      switch (n.attrs.level) {
        case 1:
          return <h2 key={key}>{content}</h2>;
        case 2:
          return <h3 key={key}>{content}</h3>;
        default:
          return <h4 key={key}>{content}</h4>;
      }
    }
    case 'bulletList':
      return <ul key={key}>{children(n.content)}</ul>;
    case 'orderedList':
      return <ol key={key}>{children(n.content)}</ol>;
    case 'listItem':
      return <li key={key}>{children(n.content)}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children(n.content)}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{(n.content ?? []).map((c) => c.text).join('')}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'table':
      return (
        <div className="ss-table-wrap" key={key}>
          <table>
            <tbody>{children(n.content)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{children(n.content)}</tr>;
    case 'tableHeader':
      return (
        <th key={key} colSpan={n.attrs?.colspan ?? 1} rowSpan={n.attrs?.rowspan ?? 1}>
          {children(n.content)}
        </th>
      );
    case 'tableCell':
      return (
        <td key={key} colSpan={n.attrs?.colspan ?? 1} rowSpan={n.attrs?.rowspan ?? 1}>
          {children(n.content)}
        </td>
      );
  }
}
