# QA matrix

Status key: **PASS** executed and passed in this repository; **NOT EXECUTED** needs a real Confluence Cloud site
or credentials, with exact steps below; **N/A** not applicable.

## A. Automated, executed in CI and locally (offline)

Test doubles are an in-memory store with atomic transactions and a scriptable fake Confluence. They verify our logic, not
Forge's behaviour.

| ID   | Area                                                                                                                                          | Command                                                          | Result (last run)                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| A-01 | Lint, prettier, strict typecheck (4 workspaces)                                                                                               | `npm run lint && npm run typecheck`                              | PASS                                      |
| A-02 | Domain, resolver, security matrix, shared validator, i18n, export                                                                             | `npm test` (project `backend`)                                   | PASS                                      |
| A-03 | UI components, states, editor, axe (jsdom)                                                                                                    | `npm test` (project `macro-ui`)                                  | PASS                                      |
| A-04 | UI in real Chromium against real handlers (in-memory) incl. axe with colour contrast, hostile paste, keyboard, outage, es locale, screenshots | `npm run test:e2e`                                               | PASS (6 tests)                            |
| A-05 | Production build + bundle guard                                                                                                               | `npm run build`                                                  | PASS                                      |
| A-06 | Manifest schema + policy                                                                                                                      | `npm run validate:manifest`                                      | PASS                                      |
| A-07 | Production dependency audit (high)                                                                                                            | `npm run audit:deps`                                             | PASS (6 moderate remain)                  |
| A-08 | `forge lint`                                                                                                                                  | `npm run forge:lint`                                             | NOT EXECUTED (needs `forge login`, B-001) |
| A-09 | Title/classification, access requests, temporary grants, history diff                                                                         | `npm test` (metadata, access-requests, expiry, diff, App/Editor) | PASS                                      |

Exact counts are recorded in docs/PROGRESS.md.

## B. Real-site spikes (must pass before any production claim)

Preparation: development site with a site admin **SA**, users **U1** (author), **U2** (page editor, no grant), **U3** (page viewer),
**U4** (member of group G-A), **U5** (member of group G-B), **U6** (not in any group, not able to view the page), and groups G-A, G-B, G-C.
Install the dev deployment per docs/SETUP.md.

| ID  | Steps                                                                                                                                                                                                                                                                        | Expected                                                                                                                                              | Status       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S1  | As U1 insert the macro on a _draft_, note `localId` in the resolver log (temporarily log `ctx.localId`; remove after). Publish, edit the page 3 times, restore an old version, move the page, copy the page, copy the macro within the page, copy the macro to another page. | Record what `localId` and `content.id` are in each case. Safe outcome in all cases: only the original binding shows content, copies are unconfigured. | NOT EXECUTED |
| S2  | Add `console.log(JSON.stringify(Object.keys(req.context)), req.context.extension?.content?.id)` to the resolver on a throwaway branch and open the macro on a page, a blog post, a template, a draft.                                                                        | `extension.content.id` present for pages; document findings. If missing, the product fails closed (UNAVAILABLE).                                      | NOT EXECUTED |
| S3  | U1 sets up the macro while creating a brand-new page (draft, never published).                                                                                                                                                                                               | Either setup works (permission check accepts the draft id) or shows PAGE_EDIT_REQUIRED/UNAVAILABLE; record which.                                     | NOT EXECUTED |
| S4  | Run `scripts` snippet (see below) that calls `KvsStore.transact` with `create` on an existing key and with `check` on a missing key.                                                                                                                                         | Condition failure raises an error the adapter maps to `StoreConflictError`.                                                                           | NOT EXECUTED |
| S5  | Fire 20 parallel `createSection` calls for the same (page, localId) from U1 (two browser sessions), and 10 parallel mutual administrator removals.                                                                                                                           | Exactly one section/binding; never zero administrators.                                                                                               | NOT EXECUTED |
| S6  | Use the editor in Chrome, Firefox, Safari: type, paste from Word/Google Docs, IME input, tables, links, keyboard-only.                                                                                                                                                       | Works inside the Forge iframe; dark mode follows Confluence theme.                                                                                    | NOT EXECUTED |
| S7  | `forge lint`; as SA open Diagnostics; add a group grant and sign in as U4/U5; search users/groups.                                                                                                                                                                           | No missing-scope errors; group grants work; SA detection works.                                                                                       | NOT EXECUTED |
| S8  | Export the page to PDF and Word, send the page by email/share, check notifications and page watchers digest, page history diff, search for a sentence from the content, space export (XML/HTML), Rovo/AI search.                                                             | The protected text never appears; export shows the placeholder.                                                                                       | NOT EXECUTED |

Snippet for S4/S5 (temporary function on a throwaway branch, never committed):

```ts
// src/spike.ts: export in manifest as a function behind a macro button during the spike only
import { KvsStore } from './adapters/kvs-store.js';
export const spike = async () => {
  const s = new KvsStore();
  const k = 'spike:' + Date.now();
  const mk = (rev: number) =>
    ({
      kind: 'create',
      entity: 'meta',
      key: k,
      value: { n: rev },
      index: { partition: 'meta', range: k },
    }) as const;
  await s.transact([mk(1)]);
  const r1 = await s.transact([mk(2)]).then(
    () => 'unexpected-success',
    (e) => e.name,
  );
  console.log('second create:', r1);
};
```

## C. Adversarial checklist for human testers (site admin plus three groups)

Run after S1 to S8. Record result and screenshot for each. Any leak of protected text is a **release blocker**.

Setup: SA (site admin), A1 in group **Finance**, B1 in group **HR**, C1 in group **Everyone-else**. Page P (all can view and edit), section S with: grant `Finance` = VIEW, `HR` = MODIFY, A1 additionally nothing, SA nothing. U1 is ADMINISTER.

| ID    | Scenario                                                                                                                    | Expected                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-01 | U1 creates S, writes text containing the marker `CANARY-7F3A`.                                                              | Saved; version 1 or 2 in History.                                                                                                                       |
| QA-02 | Search the site for `CANARY-7F3A` as everyone.                                                                              | No results anywhere.                                                                                                                                    |
| QA-03 | C1 opens P.                                                                                                                 | "This section is protected", no marker anywhere in DOM (inspect), network responses or console.                                                         |
| QA-04 | C1 uses DevTools to call the bridge with another account/page/section id or calls resolver functions with crafted payloads. | Generic denial; nothing leaks.                                                                                                                          |
| QA-05 | C1 edits the page body ADF/macro attributes (via REST API) to change `localId`/parameters.                                  | No access; macro becomes unconfigured.                                                                                                                  |
| QA-06 | Add a page view restriction on P that excludes A1 (A1 has a grant), then open P as A1. Then remove the restriction.         | While restricted, A1 gets no access despite the grant (page view is required in addition to the grant); access returns when the restriction is removed. |
| QA-07 | Remove A1 from `Finance`; reload as A1.                                                                                     | Access lost within one request. Delete group `HR`: B1 loses access.                                                                                     |
| QA-08 | Copy P to P2 (same space and another space). Open P2 as U1.                                                                 | Unconfigured wizard with copy warning; no original content. Use "copy content": new independent section, original ACL not copied.                       |
| QA-09 | Export P to PDF/Word as U1, as A1, as SA.                                                                                   | Placeholder panel only.                                                                                                                                 |
| QA-10 | Edit P as U2 (editor without grant): delete the macro, undo, re-insert a new macro.                                         | Original content unreachable by U2. Re-inserted new macro is unconfigured.                                                                              |
| QA-11 | U1 removes last administrator (self) while another admin exists, then tries removing the other.                             | Second removal refused (final administrator).                                                                                                           |
| QA-12 | Deactivate every administrator account; SA uses Diagnostics/Recovery with the typed word.                                   | Recovery works only for SA, only then, audit shows ADMIN_RECOVERY; SA does not see content unless they appoint themselves.                              |
| QA-13 | B1 (MODIFY) opens Permissions.                                                                                              | Not available. B1 cannot self-grant.                                                                                                                    |
| QA-14 | Install on a second site; compare IDs/references from site 1.                                                               | References from site 1 resolve to nothing on site 2.                                                                                                    |
| QA-15 | Leave a tab open 24 h or sign out in another tab, then interact.                                                            | UNAVAILABLE/auth handling; no content after sign-out.                                                                                                   |
| QA-16 | Browser cache: sign out, press Back.                                                                                        | No content visible after reload; content not in HTTP cache entries for the page (inspect).                                                              |
| QA-17 | Max-size document (150 KB), 500 grants, 100 macros on one page, 200 sections.                                               | Page stays responsive; check Forge usage dashboard.                                                                                                     |
| QA-18 | Upgrade path: deploy version N, create data, deploy N+1 (additive change), verify data.                                     | Data intact (see docs/DEPLOYMENT.md).                                                                                                                   |
| QA-19 | Uninstall and reinstall.                                                                                                    | Per Atlassian's retention: record whether data returns; page shows macro placeholder.                                                                   |

## D. Forge dependent items not covered anywhere offline

Real KVS conflict/error shapes, latency, `permission/check` against restrictions and drafts, group membership paging, rate
limits, scheduled-trigger execution, Privacy API responses, Marketplace review.
