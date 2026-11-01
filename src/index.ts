import Resolver from '@forge/resolver';
import { RESOLVER_FUNCTIONS } from '@secure-sections/shared';
import { getApp } from './composition.js';
import { exportPlaceholderAdf } from './export.js';
import { DEFAULT_RETENTION } from './domain/model.js';
import { consoleLogger } from './logger.js';

const resolver = new Resolver();
for (const name of RESOLVER_FUNCTIONS) {
  resolver.define(name, (req) => getApp().handlers[name](req as never) as never);
}

export const handler = resolver.getDefinitions();

export const adfExport = async (): Promise<ReturnType<typeof exportPlaceholderAdf>> =>
  exportPlaceholderAdf();

export const maintenance = async (): Promise<void> => {
  const app = getApp();
  try {
    const cfg = { ...DEFAULT_RETENTION, ...(await app.service.getRetention()) };
    await app.retention.sweep(cfg);
    await app.privacy.sweep();
  } catch (e) {
    consoleLogger.error('maintenance.failure', { kind: e instanceof Error ? e.name : 'unknown' });
  }
};
