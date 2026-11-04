import type { RichDoc } from './editor-schema.js';

export const SECTION_TEMPLATES = ['blank', 'credentials', 'hr', 'minutes'] as const;
export type SectionTemplate = (typeof SECTION_TEMPLATES)[number];

export function isSectionTemplate(value: unknown): value is SectionTemplate {
  return typeof value === 'string' && (SECTION_TEMPLATES as readonly string[]).includes(value);
}

const p = (text: string): RichDoc['content'][number] => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const h = (text: string): RichDoc['content'][number] => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
});

/** Seed documents. The credentials template includes a placeholder secret the author must replace. */
export function templateDoc(id: SectionTemplate): RichDoc {
  switch (id) {
    case 'blank':
      return { type: 'doc', content: [{ type: 'paragraph' }] };
    case 'credentials':
      return {
        type: 'doc',
        content: [
          h('Credentials'),
          p('System'),
          {
            type: 'paragraph',
            content: [{ type: 'secret', attrs: { label: 'Password', value: 'replace-me' } }],
          },
          p('Notes'),
        ],
      };
    case 'hr':
      return {
        type: 'doc',
        content: [
          h('HR note'),
          p('Confidential personnel note. Replace this text before sharing.'),
        ],
      };
    case 'minutes':
      return {
        type: 'doc',
        content: [h('Reserved minutes'), p('Attendees'), p('Decisions')],
      };
  }
}
