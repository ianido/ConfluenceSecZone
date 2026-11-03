import { Node, mergeAttributes } from '@tiptap/core';

/** Callout / notice. Stored as JSON and re-validated server-side; this node only edits it. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      tone: {
        default: 'info',
      },
    };
  },
  parseHTML: () => [],
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-tone': HTMLAttributes.tone }), 0];
  },
});

/** Inline image stored as a capped data URL. Remote sources are rejected by validateDoc. */
export const SecureImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
    };
  },
  parseHTML: () => [],
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

/** Visual @mention. It never grants access. */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      accountId: { default: '' },
      label: { default: '' },
    };
  },
  parseHTML: () => [],
  renderHTML({ node }) {
    return [
      'span',
      { class: 'ss-mention', 'data-account': node.attrs.accountId },
      `@${node.attrs.label}`,
    ];
  },
});

/** Secret field. The value lives in the document for anyone with view access; the reader UI masks it. */
export const SecretField = Node.create({
  name: 'secret',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      label: { default: '' },
      value: { default: '' },
    };
  },
  parseHTML: () => [],
  renderHTML({ node }) {
    return ['span', { class: 'ss-secret-edit' }, `${node.attrs.label}: ${node.attrs.value}`];
  },
});
