import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { RichDoc } from '@secure-sections/shared';
import { RichRenderer } from './Renderer';
import { renderWithI18n } from './testing';

describe('RichRenderer', () => {
  it('renders markup-looking text as inert text, never as HTML', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<img src=x onerror=alert(1)><script>alert(2)</script>' },
          ],
        },
      ],
    };
    const { container } = renderWithI18n(<RichRenderer doc={doc} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders safe links with rel protections and drops unsafe ones even if they reach the renderer', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'good',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }],
            },
            {
              type: 'text',
              text: 'bad',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    } as RichDoc;
    const { container } = renderWithI18n(<RichRenderer doc={doc} />);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(links[0]?.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('bad').closest('a')).toBeNull();
  });

  it('renders headings, lists, quotes, code blocks and tables', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'li' }] }],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x < y' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'th' }] }],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'td' }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const { container } = renderWithI18n(<RichRenderer doc={doc} />);
    for (const sel of ['h3', 'ul li', 'blockquote', 'pre code', 'table th', 'table td']) {
      expect(container.querySelector(sel), sel).not.toBeNull();
    }
  });
});
