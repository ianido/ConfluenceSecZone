import { describe, expect, it } from 'vitest';
import {
  DOC_LIMITS,
  docIsEmpty,
  EMPTY_DOC,
  isSafeHref,
  safeValidateDoc,
  validateDoc,
} from './editor-schema.js';

const p = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('isSafeHref', () => {
  it.each(['https://example.com/a?b=c', 'http://example.com', 'mailto:a@example.com'])(
    'accepts %s',
    (h) => {
      expect(isSafeHref(h)).toBe(true);
    },
  );
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    '//evil.example',
    '/relative',
    '',
    'https://exa mple.com',
    'https://example.com/\u2028',
  ])('rejects %j', (h) => {
    expect(isSafeHref(h)).toBe(false);
  });
  it('rejects non-strings and oversized', () => {
    expect(isSafeHref(undefined)).toBe(false);
    expect(isSafeHref({})).toBe(false);
    expect(isSafeHref('https://a.example/' + 'x'.repeat(DOC_LIMITS.maxHrefLength))).toBe(false);
  });
});

describe('validateDoc', () => {
  it('accepts the empty doc and a rich doc', () => {
    expect(safeValidateDoc(EMPTY_DOC).ok).toBe(true);
    const rich = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'T' }] },
      p('x', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }]),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('a')] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'x' }] },
      { type: 'horizontalRule' },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p('c')] }],
          },
        ],
      },
    );
    expect(safeValidateDoc(rich)).toMatchObject({ ok: true });
  });

  it('accepts callouts, data-url images, mentions and secret fields', () => {
    const png = `data:image/png;base64,${'A'.repeat(8)}==`;
    const rich = doc(
      {
        type: 'callout',
        attrs: { tone: 'warn' },
        content: [p('careful')],
      },
      { type: 'image', attrs: { src: png, alt: 'diagram' } },
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { accountId: 'bob', label: 'Bob' } },
          { type: 'secret', attrs: { label: 'Password', value: 's3cret' } },
        ],
      },
    );
    const out = safeValidateDoc(rich);
    expect(out.ok).toBe(true);
    if (out.ok) expect(docIsEmpty(out.doc)).toBe(false);
  });

  const rejects: [string, unknown, string][] = [
    ['null', null, 'NOT_AN_OBJECT'],
    ['array', [], 'NOT_AN_OBJECT'],
    ['string', 'x', 'NOT_AN_OBJECT'],
    ['wrong root type', { type: 'paragraph' }, 'NOT_AN_OBJECT'],
    ['empty content', { type: 'doc', content: [] }, 'BAD_STRUCTURE'],
    ['extra root key', { type: 'doc', content: [p('a')], evil: 1 }, 'BAD_ATTRS'],
    [
      '__proto__ key',
      JSON.parse('{"type":"doc","content":[{"type":"paragraph"}],"__proto__":{"x":1}}'),
      'BAD_ATTRS',
    ],
    ['remote image', doc({ type: 'image', attrs: { src: 'https://x' } }), 'UNSAFE_URL'],
    [
      'scriptable image',
      doc({ type: 'image', attrs: { src: 'javascript:alert(1)' } }),
      'UNSAFE_URL',
    ],
    ['unknown node (script)', doc({ type: 'script' }), 'UNKNOWN_NODE'],
    ['html node', doc({ type: 'html', content: '<img src=x onerror=alert(1)>' }), 'UNKNOWN_NODE'],
    ['unknown mark', doc(p('a', [{ type: 'textStyle', attrs: { color: 'red' } }])), 'UNKNOWN_MARK'],
    [
      'javascript link',
      doc(p('a', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      'UNSAFE_URL',
    ],
    [
      'link extra attrs',
      doc(p('a', [{ type: 'link', attrs: { href: 'https://a.example', onclick: 'x' } }])),
      'BAD_ATTRS',
    ],
    ['paragraph with attrs', doc({ type: 'paragraph', attrs: { style: 'x' } }), 'BAD_ATTRS'],
    ['heading level 9', doc({ type: 'heading', attrs: { level: 9 } }), 'BAD_ATTRS'],
    ['heading level string', doc({ type: 'heading', attrs: { level: '1' } }), 'BAD_ATTRS'],
    [
      'empty text node',
      doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] }),
      'BAD_STRUCTURE',
    ],
    [
      'non-string text',
      doc({ type: 'paragraph', content: [{ type: 'text', text: 5 }] }),
      'BAD_STRUCTURE',
    ],
    ['text too long', doc(p('a'.repeat(DOC_LIMITS.maxTextLength + 1))), 'TEXT_TOO_LONG'],
    [
      'bad code language',
      doc({ type: 'codeBlock', attrs: { language: '"><script>' } }),
      'BAD_ATTRS',
    ],
    [
      'marks in code',
      doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] }),
      'UNKNOWN_MARK',
    ],
    ['listItem outside list', doc({ type: 'listItem', content: [p('a')] }), 'UNKNOWN_NODE'],
    [
      'colspan huge',
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', attrs: { colspan: 1e9 }, content: [p('x')] }],
          },
        ],
      }),
      'BAD_ATTRS',
    ],
  ];
  it.each(rejects)('rejects %s', (_n, input, issue) => {
    const r = safeValidateDoc(input);
    expect(r).toEqual({ ok: false, issue });
  });

  it('rejects documents that are too deep', () => {
    let node: unknown = p('x');
    for (let i = 0; i < DOC_LIMITS.maxDepth + 3; i++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(safeValidateDoc(doc(node))).toEqual({ ok: false, issue: 'TOO_DEEP' });
  });

  it('rejects documents with too many nodes', () => {
    const many = Array.from({ length: DOC_LIMITS.maxNodes + 1 }, () => ({
      type: 'horizontalRule',
    }));
    expect(safeValidateDoc(doc(...many))).toEqual({ ok: false, issue: 'TOO_MANY_NODES' });
  });

  it('rejects oversized serialised documents', () => {
    const paras = Array.from({ length: 30 }, () => p('a'.repeat(9_000)));
    expect(safeValidateDoc(doc(...paras))).toEqual({ ok: false, issue: 'TOO_LARGE' });
  });

  it('does not throw on circular or exotic input', () => {
    const a: Record<string, unknown> = { type: 'doc' };
    a.content = a;
    expect(safeValidateDoc(a).ok).toBe(false);
    expect(safeValidateDoc({ type: 'doc', content: [{ type: 'paragraph', content: 1n }] }).ok).toBe(
      false,
    );
  });

  it('rebuilds the document dropping nothing unsafe and de-duplicates marks', () => {
    const out = validateDoc(doc(p('a', [{ type: 'bold' }, { type: 'bold' }])));
    expect(JSON.stringify(out)).toBe(JSON.stringify(doc(p('a', [{ type: 'bold' }]))));
  });
});

describe('docIsEmpty', () => {
  it('detects empty and non-empty', () => {
    expect(docIsEmpty(EMPTY_DOC)).toBe(true);
    expect(docIsEmpty(validateDoc(doc(p('   '))))).toBe(true);
    expect(docIsEmpty(validateDoc(doc(p('hi'))))).toBe(false);
    expect(docIsEmpty(validateDoc(doc({ type: 'horizontalRule' })))).toBe(false);
  });
});
