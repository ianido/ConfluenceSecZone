# ADR-0003: Write policy: section role AND page edit right

Status: accepted

Content writes need section MODIFY or higher **and** Confluence page edit for the same user, checked at request
time via `permission/check` (operation `update`, subject = the invoking user). Rationale: the macro lives in
the page; someone who cannot edit the page should not change what the page displays. ACL administration does not
require page edit (an administrator may manage access from a read-only page), but deleting a section and setting
one up do, because they change page behaviour.

UX: a MODIFY holder without page edit sees "also requires permission to edit this page" and a read-only view.
Verified in `authz.test.ts` and `App.test.tsx`.
