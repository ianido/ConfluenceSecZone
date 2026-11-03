# Administrator guide

For Confluence site administrators installing Secure Sections.

## What the app does and does not do

- Adds one macro, **Secure Section**, a **My secure sections** page, a **Secure Sections** site settings screen,
  and a page byline. Content typed into the macro is stored in the app's Forge storage, **not** in the
  Confluence page. Page permissions and section permissions are separate, and **both** apply: a person must be able
  to view the page _and_ hold a grant on the section.
- Does not send data outside Atlassian: no external services, no analytics. In-app notices are not Confluence notifications.

## Permissions (scopes) requested and why

Full rationale in docs/marketplace/SCOPES_RATIONALE.md. In short: `storage:app` (store sections),
`read:confluence-content.permission` and `read:content-details:confluence` (check that the _current user_ can view/edit the page),
`read:content.restriction:confluence` (read the page's own restrictions so an administrator can seed a section ACL),
`read:page:confluence` (tell a deleted page from a page the caller cannot open, for the orphan row),
`read:confluence-user` and `read:confluence-groups` (search people and groups when granting access and resolve group
membership), `report:personal-data` (Atlassian's mandatory privacy reporting).

The two restriction and page scopes are new. Installing or upgrading to a build that declares them asks a site
administrator to consent again. Until that consent is given, seeding from page restrictions and the orphan check
cannot call Confluence.

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
the macro's Help/Diagnostics area, or from **Settings → Secure Sections**: type the confirmation word and nominate
a new administrator. This is audited permanently and works only when no active administrator remains. The site
administrator does not automatically see the content; whoever they nominate controls access.

## Site settings

Confluence **Settings → Secure Sections** (site administrators only):

- Who may create a section (page editors, or site administrators only), whether access requests are allowed, whether a change note is required, and the longest grant a guest may receive (up to 365 days). A grant whose **target** is a site administrator may use the full 365 days. A site administrator granting a guest is still capped.
- Per classification: watermark, minutes before auto-lock, and protect copy. Restricted starts with watermark, 5 minutes and protect copy. The others start off. These settings make casual copying harder. They do not hide the document from someone who already has View.
- Retention numbers. Saving writes the same retention record the daily job already reads.
- Diagnostics: section count, whether any section has no active administrator (with recovery), orphan pages, and the time of the last finished retention pass. Recovery asks for the word RECOVER, adds one administrator, and does not return content.

The macro's own Diagnostics screen still shows schema version, counts and a storage round trip, and still hides content.

## Reading protection and secret fields

A secret field is a labelled value inside the document. View is enough to read it, including from storage. Activity records the label when someone reveals or copies it in the UI, and does not record the value. Do not use a secret field for a value that other viewers of the same section must not know.

## Uninstall and data retention

- Uninstalling removes the macro from use; Atlassian's app data retention rules apply to Forge storage
  (confirm the current period with Atlassian before promising a deletion timeline to your organisation).
- Content was never in page bodies, so page history does not contain it. Page history keeps only the (empty) macro node.
- Within the app: deleted sections are kept 30 days and then purged with their history; older revisions (default >365 days or beyond 50) and activity entries (>730 days) are pruned daily.

## Limits

150 KB per document, image source 80 KB, secret value 2 000 characters, 500 grants, 20 in-app notices, 8 people named at creation, 20 pages per section, 100 secure macros bound per page. CSV export is 500 audit rows and contains no content.
