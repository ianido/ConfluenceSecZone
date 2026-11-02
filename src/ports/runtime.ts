export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  uuid(): string;
}
export interface Logger {
  /** Structured, content-free diagnostics only. Never pass user content or tokens. */
  info(event: string, fields?: Record<string, string | number | boolean>): void;
  warn(event: string, fields?: Record<string, string | number | boolean>): void;
  error(event: string, fields?: Record<string, string | number | boolean>): void;
}

export const systemClock: Clock = { now: () => new Date() };
