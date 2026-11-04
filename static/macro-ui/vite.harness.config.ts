import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import type * as WorldModule from '../../src/testing/world.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function backendHarness(): Plugin {
  return {
    name: 'secure-sections-backend-harness',
    configureServer(server: ViteDevServer) {
      type World = WorldModule.World;
      let world: World | null = null;
      const load = async () => {
        const m = (await server.ssrLoadModule(
          `${repoRoot}src/testing/world.ts`,
        )) as typeof WorldModule;
        return m;
      };
      const seed = async () => {
        const m = await load();
        const w = m.makeWorld();
        for (const u of ['alice', 'bob', 'carol', 'dave', 'erin'])
          w.gateway.addUser(u, u[0]!.toUpperCase() + u.slice(1));
        w.gateway.addGroup('g-hr', 'HR', ['carol']);
        w.gateway.addGroup('g-eng', 'Engineering', ['dave']);
        const full = { canView: true, canEdit: true };
        for (const u of ['alice', 'bob', 'carol', 'dave']) w.gateway.setPage('1001', u, full);
        w.gateway.setPage('1001', 'erin', { canView: true, canEdit: false });
        for (const u of ['alice', 'bob', 'carol', 'dave']) w.gateway.setPage('2002', u, full);
        world = w;
      };
      const readBody = (req: IncomingMessage) =>
        new Promise<string>((resolve) => {
          let b = '';
          req.on('data', (c) => (b += c));
          req.on('end', () => resolve(b));
        });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        try {
          if (url.pathname === '/__reset') {
            await seed();
            res.end('ok');
            return;
          }
          if (url.pathname === '/__page-title') {
            const w = world ?? (await seed(), world!);
            const id = url.searchParams.get('pageId') ?? '';
            const title = url.searchParams.get('title') ?? '';
            if (id && title) w.gateway.setPageTitle(id, title);
            res.end('ok');
            return;
          }
          if (url.pathname === '/__failing') {
            const w = world ?? (await seed(), world!);
            if (url.searchParams.get('on') === '1') w.store.failReads = true;
            else w.store.failReads = false;
            res.end('ok');
            return;
          }
          if (url.pathname.startsWith('/__invoke/')) {
            if (!world) await seed();
            const fn = url.pathname.slice('/__invoke/'.length);
            const m = await load();
            const ctx = m.ctxFor(url.searchParams.get('actor')!, {
              pageId: url.searchParams.get('pageId')!,
              localId: url.searchParams.get('localId')!,
            });
            const handler = (
              world!.handlers as unknown as Record<string, (r: unknown) => Promise<unknown>>
            )[fn];
            if (!handler) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const raw = await readBody(req);
            const out = await handler({
              payload: raw ? JSON.parse(raw) : {},
              context: m.rawContext(ctx),
            });
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(out));
            return;
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  plugins: [react(), backendHarness()],
  server: { port: 5199, strictPort: true, fs: { allow: [repoRoot] } },
});
