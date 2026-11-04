import { describe, expect, it } from 'vitest';
import { DIFF_CELL_BUDGET, diffDocs, diffLines, docToLines } from './diff.js';
import type { RichDoc } from './editor-schema.js';

const doc = (text: string): RichDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('document diff', () => {
  it('flattens headings, lists and quotes to lines', () => {
    const d: RichDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
          ],
        },
      ],
    };
    expect(docToLines(d)).toEqual(['## Title', '• one']);
  });

  it('marks inserted and deleted lines without inventing content', () => {
    const from = doc('alpha');
    const to: RichDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'alpha' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'beta' }] },
      ],
    };
    expect(diffDocs(from, to)).toEqual([
      { kind: 'equal', text: 'alpha' },
      { kind: 'add', text: 'beta' },
    ]);
    expect(diffDocs(to, from)).toEqual([
      { kind: 'equal', text: 'alpha' },
      { kind: 'del', text: 'beta' },
    ]);
  });

  it('does not allocate a full matrix once the line counts exceed the budget', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    expect(lines.length * (lines.length + 1)).toBeGreaterThan(DIFF_CELL_BUDGET);
    const next = [...lines, 'tail'];
    const diff = diffLines(lines, next);
    expect(diff.filter((d) => d.kind === 'equal')).toHaveLength(lines.length);
    expect(diff.filter((d) => d.kind === 'add').map((d) => d.text)).toEqual(['tail']);
  });

  it('treats two empty documents as equal', () => {
    const empty: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(diffDocs(empty, empty)).toEqual([{ kind: 'equal', text: '' }]);
  });
});
