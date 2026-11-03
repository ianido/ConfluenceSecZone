# ADR 0010 — Editor extras, sharing helpers, reader deterrence and site surfaces

## Status

Accepted.

## Context

The first editor covered paragraphs, lists, links, tables and code. Administrators still retyped the same ACL,
could not start from the page's own restrictions, and could not label a version. Restricted sections had no
on-screen reminder of who was reading. There was also no place that listed every section a person administers,
and no byline on the page. Confluence notifications and a two-person approval rule were considered and left
out: notifications need further scopes, and neither idea had a mockup that this change set was allowed to build.

## Decision

- New nodes stay on the shared allow-list: callout (`info` or `warn`), data-URL image, mention, and secret
  field. A mention is a display chip. It is not a grant. An image source must be a png, jpeg, gif or webp data
  URL of at most 80 KB. Remote URLs are rejected. A secret value is stored in the document. Anyone with VIEW
  can read it, and so can anyone who can read app storage. The UI's reveal and copy actions write
  `SECRET_REVEAL` with the label only.
- `copyGrants` requires ADMINISTER on the source and the target. It copies missing, non-expired grants and does
  not remove anyone. A missing or forbidden source returns the same denial, so the call is not an oracle.
  `seedPageRestrictions` maps page read restrictions to VIEW and page update restrictions to MODIFY (the higher
  role wins), skips missing or inactive principals, and changes nothing when there is nothing new. Both need
  `read:content.restriction:confluence`. Empty page restrictions do not wipe the ACL.
- Notices are records on the section (cap 20), shown to the user who was just added, and dismissed without an
  audit entry. They are not Confluence notifications.
- A revision tag is at most 40 characters and is not copied into the audit payload. History compares any two
  versions as a plain-text line diff and as side-by-side rendered text. The line diff masks a secret as
  `[secret: label]`.
- Watermark, inactivity lock, `user-select: none` and print hiding are deterrence. The server computes them
  from the classification and the site policy and returns them on a READY view. Restricted defaults to
  watermark, 5 minutes and protect-copy. Internal and Confidential default to off. A VIEW response still
  contains the document.
- **My secure sections** lists sections where the caller has a direct role. Group membership is fetched once;
  if that lookup is incomplete, group-only access is omitted. The page returns no content. CSV export is audit
  metadata, 500 rows, with no request reasons. Deleting an orphan requires ADMINISTER and a 404 from
  `read:page:confluence`. A 403 is `UNKNOWN` and is not treated as deleted.
- Site settings store `allowRequests`, `maxGrantDays`, `requireChangeNote` and `whoMayCreate`, plus
  per-classification deterrence. Retention stays in its existing meta record. The guest grant cap follows the
  **target**: it is raised only when that user is a site administrator. Groups always use the policy cap.
  `recoverUnowned` needs a site administrator, the word `RECOVER`, an active section and no active
  administrator. It returns no content.
- Templates seed revision 1. The credentials template uses the placeholder `replace-me` because the validator
  rejects an empty secret. The audit of creation must not contain that placeholder. The byline lists title,
  classification and the caller's role, or the word "request". It requires page view and returns no content.
- The stored schema stays version 1. The new fields are optional. Readers treat them as absent on older records.

## Consequences

- A site administrator must consent again to `read:content.restriction:confluence` and `read:page:confluence`
  before those two calls succeed on a site.
- The GitHub wiki stays unchanged until this UI is deployed and exercised (T-WIKI-1).
- A secret field is the wrong control for a value that other viewers of the same section must not know.
- Watermark and auto-lock must be described as deterrence in the user and admin guides.
