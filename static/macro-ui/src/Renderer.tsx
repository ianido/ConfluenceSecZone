import { useEffect, useState, type ReactNode } from 'react';
import {
  isDataImage,
  isSafeHref,
  type BlockNode,
  type InlineNode,
  type RichDoc,
} from '@secure-sections/shared';
import { useT } from './i18n';

/**
 * Renders validated RichDoc JSON to React elements. There is no HTML parsing and no
 * dangerouslySetInnerHTML anywhere: text is always rendered as text nodes, and link hrefs are
 * re-checked here even though the server already validated them (defence in depth).
 */
export function RichRenderer({
  doc,
  onRevealSecret,
}: {
  doc: RichDoc;
  /** Called when a reader reveals a secret. Must not receive the secret value. */
  onRevealSecret?: (label: string) => void;
}) {
  return <div className="ss-prose">{doc.content.map((b, i) => block(b, i, onRevealSecret))}</div>;
}

function SecretChip({
  label,
  value,
  onReveal,
}: {
  label: string;
  value: string;
  onReveal?: (label: string) => void;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!shown) return undefined;
    const timer = window.setTimeout(() => setShown(false), 15_000);
    return () => window.clearTimeout(timer);
  }, [shown]);
  return (
    <span className="ss-secret">
      <span className="ss-chip">{label}</span>{' '}
      {shown ? <span className="ss-secret-value">{value}</span> : <span>{t('secret.hidden')}</span>}{' '}
      <button
        type="button"
        className="ss-btn"
        onClick={() => {
          setShown(true);
          onReveal?.(label);
        }}
      >
        {t('secret.reveal')}
      </button>
      <button
        type="button"
        className="ss-btn"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            onReveal?.(label);
          });
        }}
      >
        {copied ? t('secret.copied') : t('secret.copy')}
      </button>
    </span>
  );
}

function inline(n: InlineNode, key: number, onReveal?: (label: string) => void): ReactNode {
  if (n.type === 'hardBreak') return <br key={key} />;
  if (n.type === 'mention') {
    return (
      <span key={key} className="ss-mention" title={n.attrs.accountId}>
        @{n.attrs.label}
      </span>
    );
  }
  if (n.type === 'secret') {
    return (
      <SecretChip
        key={key}
        label={n.attrs.label}
        value={n.attrs.value}
        {...(onReveal ? { onReveal } : {})}
      />
    );
  }
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

function children(nodes: BlockNode[], onReveal?: (label: string) => void): ReactNode[] {
  return nodes.map((c, i) => block(c, i, onReveal));
}

function block(n: BlockNode, key: number, onReveal?: (label: string) => void): ReactNode {
  switch (n.type) {
    case 'paragraph':
      return <p key={key}>{(n.content ?? []).map((c, i) => inline(c, i, onReveal))}</p>;
    case 'heading': {
      const content = (n.content ?? []).map((c, i) => inline(c, i, onReveal));
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
      return <ul key={key}>{children(n.content, onReveal)}</ul>;
    case 'orderedList':
      return <ol key={key}>{children(n.content, onReveal)}</ol>;
    case 'listItem':
      return <li key={key}>{children(n.content, onReveal)}</li>;
    case 'blockquote':
      return <blockquote key={key}>{children(n.content, onReveal)}</blockquote>;
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
            <tbody>{children(n.content, onReveal)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{children(n.content, onReveal)}</tr>;
    case 'tableHeader':
      return (
        <th key={key} colSpan={n.attrs?.colspan ?? 1} rowSpan={n.attrs?.rowspan ?? 1}>
          {children(n.content, onReveal)}
        </th>
      );
    case 'tableCell':
      return (
        <td key={key} colSpan={n.attrs?.colspan ?? 1} rowSpan={n.attrs?.rowspan ?? 1}>
          {children(n.content, onReveal)}
        </td>
      );
    case 'callout':
      return (
        <aside key={key} className={`ss-callout ss-${n.attrs.tone}`} data-tone={n.attrs.tone}>
          {children(n.content, onReveal)}
        </aside>
      );
    case 'image':
      return isDataImage(n.attrs.src) ? (
        <img key={key} src={n.attrs.src} alt={n.attrs.alt} />
      ) : null;
  }
}
