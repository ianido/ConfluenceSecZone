# Changelog

All notable changes. Format based on Keep a Changelog. Versions are internal until a release is approved.

## [Unreleased] - 0.1.0 (internal test candidate)

### Added

- Optional section title and classification (Internal / Confidential / Restricted) on the header, set at creation or later by an administrator. They are visible to anyone who can view the page.
- Access requests from the denied card (VIEW or MODIFY, optional reason). Administrators review them in Permissions; requests expire after 30 days.
- Temporary grants with a 7 / 30 / 90-day expiry, a last-access column, and renewal of expired people. An expired administrator does not count as the last administrator.
- Optional change note on save and a line-level History comparison against the previous version.
- Editor polish: vector toolbar icons, word count, `Ctrl+S`.
- Editor nodes: heading levels H1–H4, a `/` menu (table, code, callout), visual @mentions (display only, not a grant), data-URL images (png/jpeg/gif/webp, source at most 80 KB), info and warn callouts, inline secret fields, and fullscreen editing.
- Permission helpers: copy missing grants from another section, seed grants from the page's own restrictions, add several people at once, and an in-app notice when you are added. Notices are not Confluence notifications.
- Revision labels (40 characters) and a comparison of any two versions, as a line diff and side by side. Secret values appear in the line diff as `[secret: label]`.
- Reader deterrence for a classification: watermark (name and date), inactivity auto-lock, and discouraging select/print. Revealing a secret field is audited with the label only. Defaults: Restricted on (watermark, 5 minutes, protect copy); Internal and Confidential off.
- **My secure sections** global page: counts, filters, orphan rows for deleted pages, recent activity without content, and a CSV export of audit metadata (500 rows).
- Site settings: request and grant policy, per-classification deterrence, retention numbers, diagnostics, and recovery of a section that has no active administrator.
- Creation templates (blank, credentials, HR, minutes) as cards, an optional person or group to share with at creation, and a page byline that lists title, classification and your role. The byline never shows content. Directory search before the section exists is limited to someone who is allowed to create it.
- Reader **Lock now** and a countdown while auto-lock is enabled. The image description is asked only when inserting an image. The editor hints at `/` and `@`.
- Site policy **Open sections locked** (on by default). A section with content opens locked for every reader, including an administrator. Turn it off and the content is visible immediately. Lock now and inactivity auto-lock still apply. A policy saved before this switch stays on.
- Site settings use the mockup layout: side navigation, policy toggles, retention, classification badges, diagnostics and recovery.
- Mockup chrome on every screen: lock and gear icons, colored classification and status pills, initials avatars, template marks, a repeating watermark, and green/red lines in the history diff.
- My sections no longer fails when the storage query asks for more than 100 rows. Forge rejects that page size, and the screen was showing the generic error.
- Scopes `read:content.restriction:confluence` (read the page's restrictions in order to seed an ACL) and `read:page:confluence` (tell a deleted page from a page you cannot see). Installing this build needs an administrator to accept them again.
- Forge macro `secure-section-macro` with Custom UI (React 19, Tiptap 3), resolver, `adfExport` placeholder and daily maintenance trigger.
- Domain: binding protocol, ACL with VIEW/MODIFY/ADMINISTER, final-administrator rule, revisions, hash-chained audit, retention, privacy anonymisation, site-admin recovery.
- Storage adapter for Forge Custom Entity Store transactions (not yet executed against a live site).
- English and Spanish UI, accessibility tests, Playwright UI tests (in-memory harness).
- Documentation set (docs/), CI workflow, dependabot configuration, Marketplace material drafts.

### Security

- Pinned `prosemirror-view` >= 1.42.9 (GHSA-c8x8-7fp4-3x9w) and removed a duplicate ProseMirror copy from the bundle.
- Added the missing `report:personal-data` scope and a 7-day personal-data reporting floor.
- A secret field value lives in the stored document. Anyone with View, and anyone who can read app storage, can read it. The reveal audit stores the label, never the value.
- Watermark, auto-lock and copy/print hiding are deterrence. They are not a boundary: View still returns the document.
