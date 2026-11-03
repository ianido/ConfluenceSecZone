/**
 * Strict allow-list schema for protected rich-text content (ProseMirror/Tiptap JSON).
 * Content is never stored or rendered as HTML. `validateDoc` rebuilds the document from
 * known-safe pieces and rejects anything else; the UI renders the validated tree to
 * React elements only.
 */

export const DOC_LIMITS = {
  maxJsonBytes: 150_000,
  maxDepth: 24,
  maxNodes: 5_000,
  maxTextLength: 20_000,
  maxHrefLength: 2_048,
  maxHeadingLevel: 4,
  /** data:image base64 payload, small enough that the 150KB document cap still holds. */
  maxImageSrcLength: 80_000,
  maxAltLength: 200,
  maxMentionLabel: 80,
  maxSecretLabel: 40,
  maxSecretValue: 2_000,
} as const;

export const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const;

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } };

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export type CalloutTone = 'info' | 'warn';

export type BlockNode =
  | { type: 'paragraph'; content?: InlineNode[] }
  | { type: 'heading'; attrs: { level: number }; content?: InlineNode[] }
  | { type: 'bulletList'; content: BlockNode[] }
  | { type: 'orderedList'; content: BlockNode[] }
  | { type: 'listItem'; content: BlockNode[] }
  | { type: 'blockquote'; content: BlockNode[] }
  | { type: 'codeBlock'; attrs?: { language?: string }; content?: TextNode[] }
  | { type: 'horizontalRule' }
  | { type: 'table'; content: BlockNode[] }
  | { type: 'tableRow'; content: BlockNode[] }
  | { type: 'tableCell'; attrs?: CellAttrs; content: BlockNode[] }
  | { type: 'tableHeader'; attrs?: CellAttrs; content: BlockNode[] }
  | { type: 'callout'; attrs: { tone: CalloutTone }; content: BlockNode[] }
  | { type: 'image'; attrs: { src: string; alt: string } };

export type InlineNode =
  | TextNode
  | { type: 'hardBreak' }
  | { type: 'mention'; attrs: { accountId: string; label: string } }
  | { type: 'secret'; attrs: { label: string; value: string } };
export interface CellAttrs {
  colspan?: number;
  rowspan?: number;
}
export interface RichDoc {
  type: 'doc';
  content: BlockNode[];
}

export const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

export type DocIssue =
  | 'NOT_AN_OBJECT'
  | 'TOO_LARGE'
  | 'TOO_DEEP'
  | 'TOO_MANY_NODES'
  | 'TEXT_TOO_LONG'
  | 'UNKNOWN_NODE'
  | 'UNKNOWN_MARK'
  | 'UNSAFE_URL'
  | 'BAD_ATTRS'
  | 'BAD_STRUCTURE';

export class DocValidationError extends Error {
  readonly issue: DocIssue;
  constructor(issue: DocIssue) {
    super(issue);
    this.name = 'DocValidationError';
    this.issue = issue;
  }
}

const DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
const MENTION_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

/** Inline images are data URLs only. Remote and scriptable sources are rejected. */
export function isDataImage(raw: unknown): raw is string {
  return (
    typeof raw === 'string' && raw.length <= DOC_LIMITS.maxImageSrcLength && DATA_IMAGE_RE.test(raw)
  );
}

function hasCtl(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

function plainLabel(raw: unknown, max: number): string {
  if (typeof raw !== 'string') fail('BAD_ATTRS');
  const t = raw.trim();
  if (t.length === 0 || t.length > max || hasCtl(t)) fail('BAD_ATTRS');
  return t;
}

export function isSafeHref(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.length > DOC_LIMITS.maxHrefLength) return false;
  // Reject control chars and whitespace anywhere (blocks "java\tscript:" style obfuscation).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (ALLOWED_LINK_SCHEMES as readonly string[]).includes(url.protocol);
}

interface Budget {
  nodes: number;
}

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(issue: DocIssue): never {
  throw new DocValidationError(issue);
}

function count(b: Budget): void {
  b.nodes += 1;
  if (b.nodes > DOC_LIMITS.maxNodes) fail('TOO_MANY_NODES');
}

function intAttr(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail('BAD_ATTRS');
  return v;
}

function emptyAttrs(attrs: unknown): void {
  if (attrs === undefined || attrs === null) return;
  if (!isObj(attrs) || Object.keys(attrs).length > 0) fail('BAD_ATTRS');
}

function onlyKeys(o: Raw, allowed: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail('BAD_ATTRS');
}

function marks(raw: unknown): Mark[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 8) fail('BAD_STRUCTURE');
  const out: Mark[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!isObj(m) || typeof m.type !== 'string') fail('UNKNOWN_MARK');
    if (seen.has(m.type)) continue;
    seen.add(m.type);
    switch (m.type) {
      case 'bold':
      case 'italic':
      case 'strike':
      case 'code':
        onlyKeys(m, ['type']);
        out.push({ type: m.type });
        break;
      case 'link': {
        onlyKeys(m, ['type', 'attrs']);
        const attrs = m.attrs;
        if (!isObj(attrs)) fail('BAD_ATTRS');
        onlyKeys(attrs, ['href', 'target', 'rel', 'class']);
        if (!isSafeHref(attrs.href)) fail('UNSAFE_URL');
        out.push({ type: 'link', attrs: { href: attrs.href } });
        break;
      }
      default:
        fail('UNKNOWN_MARK');
    }
  }
  return out.length ? out : undefined;
}

function textNode(n: Raw, b: Budget): TextNode {
  onlyKeys(n, ['type', 'text', 'marks']);
  if (typeof n.text !== 'string' || n.text.length === 0) fail('BAD_STRUCTURE');
  if (n.text.length > DOC_LIMITS.maxTextLength) fail('TEXT_TOO_LONG');
  count(b);
  const m = marks(n.marks);
  return m ? { type: 'text', text: n.text, marks: m } : { type: 'text', text: n.text };
}

function inlineContent(raw: unknown, b: Budget): InlineNode[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) fail('BAD_STRUCTURE');
  return raw.map((c): InlineNode => {
    if (!isObj(c)) fail('BAD_STRUCTURE');
    if (c.type === 'text') return textNode(c, b);
    if (c.type === 'hardBreak') {
      onlyKeys(c, ['type']);
      count(b);
      return { type: 'hardBreak' };
    }
    if (c.type === 'mention') {
      onlyKeys(c, ['type', 'attrs']);
      if (!isObj(c.attrs)) fail('BAD_ATTRS');
      onlyKeys(c.attrs, ['accountId', 'label']);
      const accountId = c.attrs.accountId;
      if (typeof accountId !== 'string' || !MENTION_ID_RE.test(accountId)) fail('BAD_ATTRS');
      count(b);
      return {
        type: 'mention',
        attrs: { accountId, label: plainLabel(c.attrs.label, DOC_LIMITS.maxMentionLabel) },
      };
    }
    if (c.type === 'secret') {
      onlyKeys(c, ['type', 'attrs']);
      if (!isObj(c.attrs)) fail('BAD_ATTRS');
      onlyKeys(c.attrs, ['label', 'value']);
      const value = c.attrs.value;
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > DOC_LIMITS.maxSecretValue ||
        hasCtl(value)
      ) {
        fail('BAD_ATTRS');
      }
      count(b);
      return {
        type: 'secret',
        attrs: { label: plainLabel(c.attrs.label, DOC_LIMITS.maxSecretLabel), value },
      };
    }
    return fail('UNKNOWN_NODE');
  });
}

function blockList(raw: unknown, b: Budget, depth: number, allowed: string[]): BlockNode[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('BAD_STRUCTURE');
  return raw.map((c) => block(c, b, depth, allowed));
}

const BLOCKS_IN_CONTAINER = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'callout',
  'image',
];

const CALLOUT_CHILDREN = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
];

function block(raw: unknown, b: Budget, depth: number, allowed: string[]): BlockNode {
  if (depth > DOC_LIMITS.maxDepth) fail('TOO_DEEP');
  if (!isObj(raw) || typeof raw.type !== 'string') fail('UNKNOWN_NODE');
  if (!allowed.includes(raw.type)) fail('UNKNOWN_NODE');
  count(b);
  const next = depth + 1;
  switch (raw.type) {
    case 'paragraph': {
      onlyKeys(raw, ['type', 'content', 'attrs']);
      emptyAttrs(raw.attrs);
      const content = inlineContent(raw.content, b);
      return content ? { type: 'paragraph', content } : { type: 'paragraph' };
    }
    case 'heading': {
      onlyKeys(raw, ['type', 'content', 'attrs']);
      if (!isObj(raw.attrs)) fail('BAD_ATTRS');
      onlyKeys(raw.attrs, ['level']);
      const level = intAttr(raw.attrs.level, 1, DOC_LIMITS.maxHeadingLevel);
      const content = inlineContent(raw.content, b);
      return content
        ? { type: 'heading', attrs: { level }, content }
        : { type: 'heading', attrs: { level } };
    }
    case 'bulletList':
    case 'orderedList': {
      onlyKeys(raw, ['type', 'content', 'attrs']);
      if (raw.attrs !== undefined) {
        if (!isObj(raw.attrs)) fail('BAD_ATTRS');
        onlyKeys(raw.attrs, ['start', 'type']);
        if (raw.attrs.start !== undefined) intAttr(raw.attrs.start, 1, 1_000_000);
        if (raw.attrs.type !== undefined && raw.attrs.type !== null && raw.attrs.type !== '1') {
          fail('BAD_ATTRS');
        }
      }
      return { type: raw.type, content: blockList(raw.content, b, next, ['listItem']) };
    }
    case 'listItem':
      onlyKeys(raw, ['type', 'content']);
      return {
        type: 'listItem',
        content: blockList(raw.content, b, next, BLOCKS_IN_CONTAINER),
      };
    case 'blockquote':
      onlyKeys(raw, ['type', 'content']);
      return {
        type: 'blockquote',
        content: blockList(raw.content, b, next, BLOCKS_IN_CONTAINER),
      };
    case 'codeBlock': {
      onlyKeys(raw, ['type', 'content', 'attrs']);
      let language: string | undefined;
      if (raw.attrs !== undefined) {
        if (!isObj(raw.attrs)) fail('BAD_ATTRS');
        onlyKeys(raw.attrs, ['language']);
        const l = raw.attrs.language;
        if (l !== undefined && l !== null) {
          if (typeof l !== 'string' || !/^[a-z0-9+#.-]{1,30}$/i.test(l)) fail('BAD_ATTRS');
          language = l;
        }
      }
      let content: TextNode[] | undefined;
      if (raw.content !== undefined) {
        if (!Array.isArray(raw.content)) fail('BAD_STRUCTURE');
        content = raw.content.map((c) => {
          if (!isObj(c) || c.type !== 'text') fail('UNKNOWN_NODE');
          const t = textNode(c, b);
          if (t.marks) fail('UNKNOWN_MARK');
          return t;
        });
      }
      const node: BlockNode = { type: 'codeBlock' };
      if (language) node.attrs = { language };
      if (content) node.content = content;
      return node;
    }
    case 'horizontalRule':
      onlyKeys(raw, ['type']);
      return { type: 'horizontalRule' };
    case 'callout': {
      onlyKeys(raw, ['type', 'attrs', 'content']);
      if (!isObj(raw.attrs)) fail('BAD_ATTRS');
      onlyKeys(raw.attrs, ['tone']);
      const tone = raw.attrs.tone;
      if (tone !== 'info' && tone !== 'warn') fail('BAD_ATTRS');
      return {
        type: 'callout',
        attrs: { tone },
        content: blockList(raw.content, b, next, CALLOUT_CHILDREN),
      };
    }
    case 'image': {
      onlyKeys(raw, ['type', 'attrs']);
      if (!isObj(raw.attrs)) fail('BAD_ATTRS');
      onlyKeys(raw.attrs, ['src', 'alt', 'title']);
      if (!isDataImage(raw.attrs.src)) fail('UNSAFE_URL');
      const altRaw = raw.attrs.alt;
      const alt =
        altRaw === undefined || altRaw === null || altRaw === ''
          ? ''
          : plainLabel(altRaw, DOC_LIMITS.maxAltLength);
      return { type: 'image', attrs: { src: raw.attrs.src, alt } };
    }
    case 'table':
      onlyKeys(raw, ['type', 'content', 'attrs']);
      emptyAttrs(raw.attrs);
      return { type: 'table', content: blockList(raw.content, b, next, ['tableRow']) };
    case 'tableRow':
      onlyKeys(raw, ['type', 'content']);
      return {
        type: 'tableRow',
        content: blockList(raw.content, b, next, ['tableCell', 'tableHeader']),
      };
    case 'tableCell':
    case 'tableHeader': {
      onlyKeys(raw, ['type', 'content', 'attrs']);
      const attrs: CellAttrs = {};
      if (raw.attrs !== undefined) {
        if (!isObj(raw.attrs)) fail('BAD_ATTRS');
        onlyKeys(raw.attrs, ['colspan', 'rowspan', 'colwidth']);
        if (raw.attrs.colspan !== undefined) attrs.colspan = intAttr(raw.attrs.colspan, 1, 20);
        if (raw.attrs.rowspan !== undefined) attrs.rowspan = intAttr(raw.attrs.rowspan, 1, 50);
        const cw = raw.attrs.colwidth;
        if (cw !== undefined && cw !== null) {
          if (!Array.isArray(cw) || cw.length > 20) fail('BAD_ATTRS');
          for (const w of cw) intAttr(w, 0, 5000);
        }
      }
      const content = blockList(raw.content, b, next, BLOCKS_IN_CONTAINER);
      return Object.keys(attrs).length
        ? { type: raw.type, attrs, content }
        : { type: raw.type, content };
    }
    default:
      return fail('UNKNOWN_NODE');
  }
}

/** Validate untrusted editor JSON and return a rebuilt, known-safe document. Throws DocValidationError. */
export function validateDoc(input: unknown): RichDoc {
  if (!isObj(input) || input.type !== 'doc') fail('NOT_AN_OBJECT');
  let size: number;
  try {
    size = JSON.stringify(input).length;
  } catch {
    return fail('NOT_AN_OBJECT');
  }
  if (size > DOC_LIMITS.maxJsonBytes) fail('TOO_LARGE');
  onlyKeys(input, ['type', 'content']);
  const budget: Budget = { nodes: 0 };
  const content = blockList(input.content, budget, 1, BLOCKS_IN_CONTAINER);
  const doc: RichDoc = { type: 'doc', content };
  if (JSON.stringify(doc).length > DOC_LIMITS.maxJsonBytes) fail('TOO_LARGE');
  return doc;
}

export function safeValidateDoc(
  input: unknown,
): { ok: true; doc: RichDoc } | { ok: false; issue: DocIssue } {
  try {
    return { ok: true, doc: validateDoc(input) };
  } catch (e) {
    if (e instanceof DocValidationError) return { ok: false, issue: e.issue };
    return { ok: false, issue: 'BAD_STRUCTURE' };
  }
}

/** Plain text length, used for size indicators; never log or transmit the text itself. */
export function docIsEmpty(doc: RichDoc): boolean {
  const hasText = (n: unknown): boolean => {
    if (!isObj(n)) return false;
    if (n.type === 'text') return typeof n.text === 'string' && n.text.trim().length > 0;
    if (n.type === 'mention' || n.type === 'secret' || n.type === 'image') return true;
    if (n.type === 'horizontalRule' || n.type === 'table') return true;
    return Array.isArray(n.content) && n.content.some(hasText);
  };
  return !doc.content.some(hasText);
}
