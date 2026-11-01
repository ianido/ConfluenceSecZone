import { randomUUID } from 'node:crypto';
import { ForgeConfluenceGateway, ForgePrivacyGateway } from './adapters/forge-gateway';
import { KvsStore } from './adapters/kvs-store';
import { PrivacyService } from './domain/privacy';
import { RetentionService } from './domain/retention';
import { SecureSectionService } from './domain/service';
import { consoleLogger } from './logger';
import { systemClock } from './ports/runtime';
import { createHandlers, type Handlers } from './resolvers';

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
