# Licensing strategy

**Decision status: not decided; commercial licensing is NOT enabled and must not be enabled without explicit human
approval.** `manifest.yml` has no `app.licensing` block.

## Facts (official docs, fetched 2026-11-01)

- Paid Forge apps set `app.licensing.enabled: true` and check `context.license?.active === true` (resolver) or
  `view.getContext()` (UI). The `license` object is undefined for free apps, development and staging.
  https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- Billing models: standard (all users) or user-based billing (early access at the time of writing); one per app.
  https://developer.atlassian.com/platform/forge/licensing-overview/
- License API: `GET /forge/app/v1/license`. https://developer.atlassian.com/platform/forge/apis-reference/license-api/

## Options

| Option                    | Pros                           | Cons                                                         |
| ------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Free (unlicensed)         | Simple; easiest review         | No revenue; Forge consumption costs fall on the vendor       |
| Paid, standard billing    | Predictable; widely understood | Customers pay for all users even if few use secure sections  |
| Paid, user-based billing  | Fair for niche feature         | Early access; requires `access.userAccess`; more integration |
| Free tier + paid features | Adoption                       | Complexity                                                   |

## Recommended entitlement design (if paid is chosen)

1. Enable `licensing.enabled` in a release manifest only after approval.
2. A single `Entitlements` function in the resolver layer: `canUse = context.license === undefined ? devOrFree : context.license.active === true`.
3. Unlicensed behaviour: **never lock people out of their own data**. Read-only view for people who already have
   access, no new sections, no edits, a clear banner for administrators. This avoids hostage-data and trust problems.
4. Entitlement enforced server-side in resolvers (the UI only reflects it); the default for a missing license object
   in production is "active" only when licensing is disabled in the manifest.
5. Tests for each license state before enabling.

Open questions for the business owner: price, free vs paid, trial length, region/currency, tax, partner agreement, support commitments.
