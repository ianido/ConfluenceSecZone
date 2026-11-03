import type { BlockNode, InlineNode, RichDoc } from './editor-schema.js';

export type DiffKind = 'equal' | 'add' | 'del';
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** Flatten a validated document to one plain-text line per block. Never used for rendering HTML. */
export function docToLines(doc: RichDoc): string[] {
  const out: string[] = [];
  const walk = (n: BlockNode, prefix = ''): void => {
    switch (n.type) {
      case 'paragraph':
        out.push(prefix + inlines(n.content));
        break;
      case 'heading':
        out.push(`${prefix}${'#'.repeat(n.attrs.level)} ${inlines(n.content)}`);
        break;
      case 'blockquote':
        for (const c of n.content) walk(c, `${prefix}> `);
        break;
      case 'bulletList':
      case 'orderedList':
        n.content.forEach((c, i) =>
          walk(c, `${prefix}${n.type === 'orderedList' ? `${i + 1}. ` : '• '}`),
        );
        break;
      case 'listItem':
        n.content.forEach((c) => walk(c, prefix));
        break;
      case 'codeBlock':
        out.push(`${prefix}${(n.content ?? []).map((c) => c.text).join('')}`);
        break;
      case 'horizontalRule':
        out.push(`${prefix}---`);
        break;
      case 'callout':
        out.push(`${prefix}[${n.attrs.tone}]`);
        for (const c of n.content) walk(c, prefix);
        break;
      case 'image':
        out.push(`${prefix}[image${n.attrs.alt ? `: ${n.attrs.alt}` : ''}]`);
        break;
      case 'table':
      case 'tableRow':
        n.content.forEach((c) => walk(c, prefix));
        break;
      case 'tableCell':
      case 'tableHeader':
        out.push(`${prefix}${n.content.map((c) => flatten(c)).join(' ')}`);
        break;
    }
  };
  for (const b of doc.content) walk(b);
  return out;
}

function inlines(nodes: InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return ' ';
      if (n.type === 'mention') return `@${n.attrs.label}`;
      // The secret value stays out of the line diff; viewers reveal it on purpose.
      if (n.type === 'secret') return `[secret: ${n.attrs.label}]`;
      return n.text;
    })
    .join('');
}

function flatten(n: BlockNode): string {
  const lines: string[] = [];
  const tmp: RichDoc = { type: 'doc', content: [n] };
  return docToLines(tmp).join(' ') || lines.join(' ');
}

/** Myers-style shortest edit script on two string arrays (O(n·m) is fine: docs are bounded). */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        a[i] === b[j]
          ? (dp[i + 1]![j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'equal', text: a[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j]! });
    j += 1;
  }
  return out;
}

export function diffDocs(from: RichDoc, to: RichDoc): DiffLine[] {
  return diffLines(docToLines(from), docToLines(to));
}
