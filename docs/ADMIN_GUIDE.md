# Administrator guide

For Confluence site administrators installing Secure Sections.

## What the app does and does not do

- Adds one macro, **Secure Section**. Content typed into it is stored in the app's Forge storage, **not** in the
  Confluence page. Page permissions and section permissions are separate, and **both** apply: a person must be able
  to view the page _and_ hold a grant on the section.
- Does not send data outside Atlassian: no external services, no analytics.

## Permissions (scopes) requested and why

Full rationale in docs/marketplace/SCOPES_RATIONALE.md. In short: `storage:app` (store sections),
`read:confluence-content.permission` and `read:content-details:confluence` (check that the _current user_ can view/edit the page),
`read:confluence-user` and `read:confluence-groups` (search people and groups when granting access and resolve group
membership), `report:personal-data` (Atlassian's mandatory privacy reporting).

## Installing

1. Install from Atlassian Marketplace (or `forge install` for a development build; see docs/SETUP.md).
2. Review and accept the scopes.
3. Insert the macro on a page with `/Secure Section`. The setup wizard explains: you become the first administrator;
   only people you add can read it even if they can edit the page.

## Roles

| Role          | Can                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------- |
| View          | Read the content                                                                         |
| Modify        | View + edit content (also needs page edit permission), see history, restore versions     |
| Administrator | Modify + manage permissions, see activity log, delete the section, reuse/copy references |

A person's effective role is the highest of their own grants and their group grants. There are no deny rules.
Removing the last individual administrator is blocked (an expired administrator does not count).

People without access can request View or Modify from the denied card. Administrators see a queue on the
Permissions tab. Grants may expire after 7, 30 or 90 days.

## Copying pages

A copied page shows the macro as **not set up**. This is intentional: the copy cannot read the original content.
To reuse content an administrator of the original can share its _reference_ (Help tab) and a page editor can attach it
(administrators of the original only) or copy its content into a new independent section (needs View on the original).

## If nobody can administer a section any more

If every administrator was deactivated or removed, a Confluence **site administrator** can recover the section from
the macro's Help/Diagnostics area: type the confirmation word and nominate a new administrator. This is audited
permanently and works only when no active administrator remains. The site administrator does not automatically
see the content; whoever they nominate controls access.

## Diagnostics

Site administrators see a Diagnostics screen: schema version, counts, and health checks (storage round trip). It never
shows content or permission details.

## Uninstall and data retention

- Uninstalling removes the macro from use; Atlassian's app data retention rules apply to Forge storage
  (confirm the current period with Atlassian before promising a deletion timeline to your organisation).
- Content was never in page bodies, so page history does not contain it. Page history keeps only the (empty) macro node.
- Within the app: deleted sections are kept 30 days and then purged with their history; older revisions (default >365 days or beyond 50) and activity entries (>730 days) are pruned daily.

## Limits

150 KB per document, 500 grants and 20 pages per section, 100 secure macros bound per page.
