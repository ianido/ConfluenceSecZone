# ADR-0002: Section binding protocol

Status: accepted

## Context

Atlassian staff state that the macro `localId` in the Forge context is copied when a macro is copied, even across
pages (community threads 72192 and 50559). Any scheme that uses `localId` alone as the section key lets a copied
macro, or an attacker who knows a `localId`, address someone else's section.

## Decision

1. The authority for a section is a **binding record** keyed by `pageId:localId`, where `pageId` is the content
   id from the trusted context. Both values come from `req.context` only.
2. No resolver takes a section id as authority. An unbound (`pageId`,`localId`) renders as _unconfigured_.
3. Setup (`createSection`) requires page edit; the creator becomes the first administrator; creation is a
   `create`-if-absent transaction so concurrent setup creates exactly one section.
4. `bindHere(ref)` attaches an existing section to this macro and requires ADMINISTER on that section and page
   edit here. `copyHere(ref)` creates an independent copy and requires VIEW on the source section and its page.
5. A stored binding whose cloudId/pageId/localId differs from the context is treated as NO_ACCESS (integrity).

## Consequences

- Copied pages and macros show "unconfigured" with a clear copy warning; nothing leaks.
- A moved macro keeps its binding if the page id is unchanged. Moving content between pages by cut/paste
  yields an unconfigured macro on the target and an orphan section, recoverable by `bindHere`.
- Stability of `localId` across drafts, publish, edit and restore is unverified (S1). The failure mode is
  safe: the macro shows unconfigured and the data stays recoverable.
