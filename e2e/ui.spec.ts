/**
 * UI-level end-to-end tests: real React UI + real resolver handlers + real domain service, running
 * against an in-memory store and a fake Confluence (see static/macro-ui/vite.harness.config.ts).
 * These are NOT Forge end-to-end tests: Forge bridge, KVS and Confluence behaviour are unverified
 * here and are tracked in docs/QA_MATRIX.md.
 */
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const SECRET = 'Quarterly layoffs plan 4711';

const open = async (page: Page, actor: string, extra = '') => {
  await page.goto(`/?actor=${actor}${extra}`);
};

async function axe(page: Page) {
  await page.addScriptTag({ path: require.resolve('axe-core') });
  const violations = await page.evaluate(async () => {
    const r = await (
      window as unknown as {
        axe: { run: (c: unknown, o: unknown) => Promise<{ violations: unknown[] }> };
      }
    ).axe.run('#root', {
      rules: {
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });
    return r.violations;
  });
  expect(violations).toEqual([]);
}

test.beforeEach(async ({ request }) => {
  await request.get('/__reset');
});

test('author creates, edits and shares a section; unauthorised editor sees nothing', async ({
  page,
  browser,
}) => {
  await open(page, 'alice');
  await expect(page.getByRole('heading', { name: 'Set up your secure section' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'docs/screenshots/01-setup-wizard.png' });
  await page.getByRole('button', { name: 'Set up secure section' }).click();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.ss-editor').click();
  await page.keyboard.type(SECRET);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(SECRET)).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/02-content-view.png' });
  await axe(page);

  const bob = await (await browser.newContext()).newPage();
  await open(bob, 'bob');
  await expect(bob.getByText('This section is protected')).toBeVisible();
  expect(await bob.content()).not.toContain(SECRET);
  expect(await bob.getByRole('button', { name: 'Edit', exact: true }).count()).toBe(0);
  await bob.screenshot({ path: 'docs/screenshots/03-denied.png' });
  await axe(bob);

  await page.getByRole('tab', { name: 'Permissions' }).click();
  await page.getByRole('searchbox').fill('Bob');
  await page.getByRole('button', { name: 'Search people' }).click();
  await page
    .locator('.ss-hits li', { hasText: 'Bob' })
    .getByRole('button', { name: 'Add' })
    .click();
  await expect(page.getByText('Permissions updated.')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/04-permissions.png' });
  await axe(page);

  await bob.reload();
  await bob.getByRole('button', { name: 'Unlock' }).click();
  await expect(bob.getByText(SECRET)).toBeVisible();
  expect(await bob.getByRole('button', { name: 'Edit', exact: true }).count()).toBe(0);
});

test('editor hostile paste: scripts and unsafe links are never rendered or stored', async ({
  page,
  request,
}) => {
  await open(page, 'alice');
  await page.getByRole('button', { name: 'Set up secure section' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.ss-editor').click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<p>safe</p><img src=x onerror="window.__pwned=1"><a href="javascript:window.__pwned=1">click</a><script>window.__pwned=1</script>',
    );
    document
      .querySelector('.ss-editor')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
  });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('safe')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  expect(await page.locator('#root').locator('img, script, a[href^="javascript"]').count()).toBe(0);
  const stored = await request.post(
    '/__invoke/getSection?actor=alice&pageId=1001&localId=aaaaaaaa-0000-4000-8000-000000000001',
    { data: {} },
  );
  expect(JSON.stringify(await stored.json())).not.toMatch(/javascript:|onerror|<script/);
});

test('removed access is reflected on reload and the stale view shows no content', async ({
  page,
  browser,
}) => {
  await open(page, 'alice');
  await page.getByRole('button', { name: 'Set up secure section' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('.ss-editor').click();
  await page.keyboard.type(SECRET);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('tab', { name: 'Permissions' }).click();
  await page.getByRole('searchbox').fill('Bob');
  await page.getByRole('button', { name: 'Search people' }).click();
  await page
    .locator('.ss-hits li', { hasText: 'Bob' })
    .getByRole('button', { name: 'Add' })
    .click();
  await expect(page.getByText('Permissions updated.')).toBeVisible();

  const bob = await (await browser.newContext()).newPage();
  await open(bob, 'bob');
  await bob.getByRole('button', { name: 'Unlock' }).click();
  await expect(bob.getByText(SECRET)).toBeVisible();

  await page
    .locator('li, tr', { hasText: 'Bob' })
    .getByRole('button', { name: 'Remove' })
    .first()
    .click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' });
  if (await confirm.count()) await confirm.click();
  await expect(page.getByText('Permissions updated.')).toBeVisible();

  await bob.getByRole('button', { name: 'Reload' }).click();
  await expect(bob.getByRole('heading', { name: 'Your access was removed' })).toBeVisible();
  expect(await bob.content()).not.toContain(SECRET);
});

test('storage outage shows a retryable unavailable state, not content', async ({
  page,
  request,
}) => {
  await open(page, 'alice');
  await page.getByRole('button', { name: 'Set up secure section' }).click();
  await request.get('/__failing?on=1');
  await page.reload();
  await expect(page.getByText('Temporarily unavailable')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/05-unavailable.png' });
  await request.get('/__failing?on=0');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('tab', { name: 'Content' })).toBeVisible();
});

test('Spanish locale renders accessibly', async ({ page }) => {
  await open(page, 'alice', '&locale=es');
  await expect(page.getByRole('heading', { name: 'Configura tu sección segura' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/06-es-wizard.png' });
  await axe(page);
});

test('keyboard: tabs are reachable and operable without a mouse', async ({ page }) => {
  await open(page, 'alice');
  await page.getByRole('button', { name: 'Set up secure section' }).click();
  await page.getByRole('tab', { name: 'Content' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { selected: true })).not.toHaveText('Content');
});
