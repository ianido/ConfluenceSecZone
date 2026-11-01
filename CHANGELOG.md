# Changelog

All notable changes. Format based on Keep a Changelog. Versions are internal until a release is approved.

## [Unreleased] - 0.1.0 (internal test candidate)

### Added

- Forge macro `secure-section-macro` with Custom UI (React 19, Tiptap 3), resolver, `adfExport` placeholder and daily maintenance trigger.
- Domain: binding protocol, ACL with VIEW/MODIFY/ADMINISTER, final-administrator rule, revisions, hash-chained audit, retention, privacy anonymisation, site-admin recovery.
- Storage adapter for Forge Custom Entity Store transactions (not yet executed against a live site).
- English and Spanish UI, accessibility tests, Playwright UI tests (in-memory harness).
- Documentation set (docs/), CI workflow, dependabot configuration, Marketplace material drafts.

### Security

- Pinned `prosemirror-view` >= 1.42.9 (GHSA-c8x8-7fp4-3x9w) and removed a duplicate ProseMirror copy from the bundle.
- Added the missing `report:personal-data` scope and a 7-day personal-data reporting floor.
