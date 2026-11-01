import type { TrustedContext } from '../domain/context';
import { RetentionService } from '../domain/retention';
import { PrivacyService } from '../domain/privacy';
import { SecureSectionService } from '../domain/service';
import { createHandlers } from '../resolvers';
import type { Clock, Logger } from '../ports/runtime';
import { FakeConfluence, FakePrivacy } from './fake-gateway';
import { MemoryStore } from './memory-store';

export class FakeClock implements Clock {
  constructor(private t = Date.parse('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  advanceDays(d: number): void {
    this.t += d * 86_400_000;
  }
}

export const silentLogger: Logger & { lines: string[] } = {
  lines: [],
  info(e, f) {
    this.lines.push(JSON.stringify({ e, ...f }));
  },
  warn(e, f) {
    this.lines.push(JSON.stringify({ e, ...f }));
  },
  error(e, f) {
    this.lines.push(JSON.stringify({ e, ...f }));
  },
};

export function makeWorld() {
  const store = new MemoryStore();
  const gateway = new FakeConfluence();
  const privacyGateway = new FakePrivacy();
  const clock = new FakeClock();
  let n = 0;
  const logger = { ...silentLogger, lines: [] as string[] };
  const ids = {
    uuid: () => {
      n += 1;
      const h = n.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${h}`;
    },
  };
  const service = new SecureSectionService({ store, gateway, clock, ids, logger });
  const retention = new RetentionService(store, clock, logger);
  const privacy = new PrivacyService(store, privacyGateway, clock, logger);
  const handlers = createHandlers(service, logger);
  return { store, gateway, privacyGateway, clock, service, retention, privacy, handlers, logger };
}

export type World = ReturnType<typeof makeWorld>;

export function ctxFor(
  accountId: string,
  opts: Partial<Omit<TrustedContext, 'accountId'>> = {},
): TrustedContext {
  return {
    accountId,
    cloudId: 'cloud-1',
    pageId: '1001',
    localId: 'aaaaaaaa-0000-4000-8000-000000000001',
    spaceKey: 'SEC',
    moduleKey: 'secure-section-macro',
    environmentId: 'env-1',
    locale: 'en',
    ...opts,
  };
}

/** Raw Forge resolver `context` object as the platform would deliver it. */
export function rawContext(c: TrustedContext): Record<string, unknown> {
  return {
    accountId: c.accountId,
    cloudId: c.cloudId,
    localId: c.localId,
    moduleKey: c.moduleKey,
    environmentId: c.environmentId,
    locale: c.locale,
    extension: {
      type: 'macro',
      content: { id: c.pageId, type: 'page' },
      space: { key: c.spaceKey },
    },
  };
}
