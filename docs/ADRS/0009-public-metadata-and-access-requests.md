# ADR 0009 — Public metadata and access requests

## Status

Accepted.

## Context

A page viewer without a grant used to see only a generic "this section is protected" card. They could not tell
which section it was, whom to ask, or request access without leaving Confluence. Administrators had no inbox.

## Decision

- Title (optional, max 80 characters) and classification (INTERNAL / CONFIDENTIAL / RESTRICTED) are **not secret**.
  Anyone who can view the page may learn them. The UI states this when they are edited. They must never hold
  confidential text.
- A page viewer without a grant may call `getAccessInfo`, `requestAccess` and `cancelAccessRequest`. Those
  functions return only public metadata, up to five active administrator display names, and the caller's own
  pending request. They never return content, grants or counts.
- Requests expire after 30 days, are capped at 50 per section, and never grant access by themselves. Approving
  one is a normal `GRANT_ADD` under the existing ACL version.
- Reasons are stored on the request record so the administrator can read them, but they are not copied into the
  audit payload.

## Consequences

- `getSection` for a user without a grant remains `{ state: 'DENIED' }` and discloses nothing. The extra data
  is a separate, explicit call.
- Existing sections created before this change have `title` / `classification` / `requests` absent; readers
  treat them as null / empty.
- Wiki pages that describe the denied card will be updated only after this UI is deployed and exercised.
