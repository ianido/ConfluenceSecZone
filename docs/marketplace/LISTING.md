# Marketplace listing material (DRAFT, claims must stay factual)

**Name (working):** Secure Sections for Confluence
**Tagline:** Confidential sections inside Confluence pages, with their own access list.

## Short description

Add a protected section to any page. Only the people and groups you choose can read or edit it, regardless of who
can edit the page. Built on Atlassian Forge: no external servers.

## Features (all implemented and covered by automated tests unless noted)

- Macro with a first-use setup wizard; you become the administrator.
- Rich text: headings, lists, links, quotes, code, tables.
- Per-section roles: Can view, Can edit, Administrator, by person or by group; highest role wins.
- Page permissions still apply in addition (restricted pages stay restricted).
- Version history with restore; optimistic editing conflict handling.
- Activity log with tamper-evident hash chain (not described as immutable).
- Copied pages never expose the original content.
- Exports contain a placeholder instead of the protected text (**real-site verification pending**).
- Retention controls and Atlassian privacy reporting.
- English and Spanish. Light/dark. Keyboard accessible.

## Not claimed

- No "Runs on Atlassian", "Cloud Fortified", "Enterprise Certified", SOC 2 or penetration-test claim until each is independently granted/performed.
- No claim of immutability, DLP, legal-hold or compliance certification.
- No claim that site administrators cannot obtain access (see recovery trade-off in docs/SECURITY.md).
- No performance claims beyond docs/OPERATIONS.md analytics until QA-17 runs.

## Listing fields to complete (human)

Vendor name, support URL, privacy policy URL (public), EULA link, pricing model (docs/marketplace/LICENSING_STRATEGY.md), logo,
banner, screenshots (see SCREENSHOT_PLAN.md), documentation URL (host docs/USER_GUIDE.md and docs/ADMIN_GUIDE.md), bug bounty enrolment,
Privacy & Security tab (answer using docs/marketplace/DATA_HANDLING.md), cloud security programme questionnaire.

## Policies to re-verify before submission

Atlassian Marketplace listing requirements and branding rules change; re-check
https://developer.atlassian.com/platform/marketplace/creating-a-marketplace-listing/ and
https://developer.atlassian.com/platform/marketplace/listing-forge-apps/ on the day of submission.
