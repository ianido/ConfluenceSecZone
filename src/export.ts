/**
 * ADF returned for Confluence export (PDF/Word/other). Protected content is NEVER exported:
 * the export function does not read storage and does not trust the exporting identity.
 */
export function exportPlaceholderAdf(): {
  type: 'doc';
  version: 1;
  content: Array<{ type: 'panel'; attrs: { panelType: 'note' }; content: unknown[] }>;
} {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'note' },
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Protected content. Secure Section content is not included in exports.',
              },
            ],
          },
        ],
      },
    ],
  };
}
