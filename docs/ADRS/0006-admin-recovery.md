# ADR-0006: Break-glass administrator recovery

Status: accepted (with a documented trade-off)

Problem: if every administrator account is deactivated or deleted, the section is orphaned forever.

Decision: `recoverSection` is allowed only when (1) the caller is a Confluence **site administrator**
(verified server-side via `/user/current` operations), (2) the caller can view the page, (3) the section has no
active administrator (inactive users, deleted or empty groups do not count; if this cannot be established the
operation is refused, fail closed), (4) the caller typed the confirmation word, and (5) a permanent audit entry
`ADMIN_RECOVERY` is written. It adds one named administrator (who then controls access) and returns no content.
The soft-deleted state is also recoverable within the retention grace period.

Trade-off: a site administrator can nominate themselves and so eventually read orphaned content. That
authority exists in Confluence anyway (admins can reassign ownership of everything) and is the only recovery path
that does not require the vendor. It is limited to the orphan case and fully audited. Customers who object can
simply keep an active section administrator.

Limit: the site-admin check and the shape of `/user/current` `operations` are spike S7 (NOT EXECUTED).
