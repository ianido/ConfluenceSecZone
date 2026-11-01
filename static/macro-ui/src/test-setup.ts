import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom has no layout engine; ProseMirror calls these when scrolling the selection into view.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
const zeroRect = () => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= emptyRects as never;
  Range.prototype.getBoundingClientRect ??= zeroRect as never;
}
if (typeof Element !== 'undefined') Element.prototype.getClientRects ??= emptyRects as never;
if (typeof Text !== 'undefined')
  (Text.prototype as unknown as { getClientRects?: unknown }).getClientRects ??= emptyRects;
