import type { Logger } from './ports/runtime.js';

/** Content-free structured logging. Callers must only pass identifiers/counters, never content. */
export const consoleLogger: Logger = {
  info: (event, fields) => console.info(JSON.stringify({ event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
};
