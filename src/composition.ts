import { randomUUID } from 'node:crypto';
import { ForgeConfluenceGateway, ForgePrivacyGateway } from './adapters/forge-gateway.js';
import { KvsStore } from './adapters/kvs-store.js';
import { PrivacyService } from './domain/privacy.js';
import { RetentionService } from './domain/retention.js';
import { SecureSectionService } from './domain/service.js';
import { consoleLogger } from './logger.js';
import { systemClock } from './ports/runtime.js';
import { createHandlers, type Handlers } from './resolvers.js';

export interface App {
  service: SecureSectionService;
  handlers: Handlers;
  retention: RetentionService;
  privacy: PrivacyService;
}

let app: App | undefined;

export function getApp(): App {
  if (app) return app;
  const store = new KvsStore();
  const gateway = new ForgeConfluenceGateway();
  const service = new SecureSectionService({
    store,
    gateway,
    clock: systemClock,
    ids: { uuid: () => randomUUID() },
    logger: consoleLogger,
  });
  app = {
    service,
    handlers: createHandlers(service, consoleLogger),
    retention: new RetentionService(store, systemClock, consoleLogger),
    privacy: new PrivacyService(store, new ForgePrivacyGateway(), systemClock, consoleLogger),
  };
  return app;
}
