# User guide

## Add a protected section

1. Edit a page and type `/Secure Section`.
2. Optionally give it a **title** and a **classification** (Internal, Confidential or Restricted). These are visible
   to everyone who can view the page, so do not put confidential text in them. Then choose **Set up secure section**.
   You become its administrator.
3. Choose **Edit**, write your content (headings, lists, links, tables, code), then **Save**. You can add a short
   note of what changed; it appears in History. `Ctrl+S` also saves.
4. Open the **Permissions** tab and add the people or groups who may see it. Choose _Can view_, _Can edit_ or
   _Administrator_. You can also set an expiry (7, 30 or 90 days). Only the people you add can read the content,
   even if others can edit this page.

## What others see

People without access see "This section is protected" and no content. They can see the title and classification (if
you set them), the names of a few administrators, and a form to **request access** with a level and an optional
reason. Administrators review those requests in the Permissions tab. The text is not included in page exports or
shared copies.

## Editing safely

- Nothing is saved until you press **Save**. If someone else changed the section meanwhile you can load their
  version or deliberately overwrite it.
- **History** lists versions (with the optional change note); restoring one creates a new version, never deleting
  the old one. **Compare with previous** shows added and removed lines.
- **Activity** (administrators) lists who changed what, without showing content.

## Permissions extras

- Pending access requests appear as a badge on the Permissions tab.
- Temporary access expires automatically; expired people stay listed so you can renew or remove them.
- Last access is recorded at most once per day when that person uses the section.

## Editor extras

- The heading control sets H1–H4. Typing `/` at the end of an empty token opens a menu for a table, a code block or a callout.
- **@** inserts a mention chip. A mention is a name on the page. It does not grant access.
- Images must be a picture you pick from your computer (png, jpeg, gif or webp). The app stores the picture inside the section. Remote image addresses are rejected.
- A **secret** field stores its value in the section. Anyone with Can view can read it. Showing or copying it records the field's label in Activity, never the value.
- Fullscreen expands the editor inside the macro. It does not change who can read the section.

## Sharing a section you already administer

- Add several people in one step from the Permissions tab. Each person is saved in turn.
- **Copy access from another section** copies only the grants that this section does not already have. You must administer both sections. It does not remove anyone.
- **Use this page's restrictions** turns the page's read restrictions into Can view and its edit restrictions into Can edit. People who no longer exist are skipped. If the page has no restrictions, nothing changes.
- When someone adds you, the section shows a short notice. Dismissing it does not change your access. These notices stay inside the app. Confluence does not send a notification.

## History labels

History can label a version (40 characters). The label is not copied into Activity. Choose any two versions to see a line diff and the two texts side by side. A secret field is shown as `[secret: label]` in the line diff.

## Reading a restricted section

A Restricted section can show your name and the date as a watermark, lock the text after a few minutes without activity, and discourage selecting or printing. Internal and Confidential sections do this only when a site administrator turns it on. This makes casual copying harder. It does not stop someone who can view the section from reading the stored text. Unlocking loads the section again.

## My secure sections

Open **Apps → My secure sections** (route `secure-sections`). You see sections where you have a direct role: counts of sections you administer, pending requests, grants expiring within 7 days, and sections idle for more than 90 days. Filters narrow the list. Recent activity is audit metadata and contains no content. **Export CSV** downloads up to 500 rows of the same metadata (when, action, actor, section title) and no request reasons.

If the page was deleted, the row says the page is missing. An administrator of that section can delete the orphan after typing DELETE. A page you cannot see is not treated as deleted.

## Starting from a template

The setup wizard can start from a blank section, credentials, an HR note or meeting minutes. You can name one person to share with at creation (up to eight people in the API). The credentials template includes a Password field whose value is `replace-me`; replace it before you rely on it.

The page byline **Secure sections** lists each section on that page: title, classification, and your role, or a prompt to request access. It does not show the text.

## Reusing a section on another page

Copying a page does not copy access to the protected content. On the new page choose **copy content from another section**
(you need View access to it) or ask an administrator of the original for its reference to attach it.

## Keyboard and accessibility

Tabs support the arrow keys; the editor toolbar is reachable with Tab; dialogs ask for explicit confirmation; the
interface follows Confluence light/dark theme. English and Spanish are available (your Confluence language).

## Troubleshooting

| You see                                      | Meaning                                              | What to do                                            |
| -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| "This section is protected"                  | You have no access                                   | Request access from the card, or ask an administrator |
| "Your access was removed"                    | A grant changed or expired                           | Ask an administrator; reload                          |
| "Temporarily unavailable"                    | Storage/Confluence could not be reached              | Try again; nothing was changed                        |
| "Needs attention" / corrupted                | Stored content failed integrity checks               | Contact an administrator; restore an earlier version  |
| "Also requires permission to edit this page" | You have edit rights on the section but not the page | Ask for page edit permission                          |
