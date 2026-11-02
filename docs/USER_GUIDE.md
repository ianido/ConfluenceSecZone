# User guide

## Add a protected section

1. Edit a page and type `/Secure Section`.
2. Choose **Set up secure section**. You become its administrator.
3. Choose **Edit**, write your content (headings, lists, links, tables, code), then **Save**.
4. Open the **Permissions** tab and add the people or groups who may see it. Choose _Can view_, _Can edit_ or
   _Administrator_. Only the people you add can read the content, even if others can edit this page.

## What others see

People without access see "This section is protected" and no content. The text is not included in page exports or
shared copies.

## Editing safely

- Nothing is saved until you press **Save**. If someone else changed the section meanwhile you can load their
  version or deliberately overwrite it.
- **History** lists versions; restoring one creates a new version, never deleting the old one.
- **Activity** (administrators) lists who changed what, without showing content.

## Reusing a section on another page

Copying a page does not copy access to the protected content. On the new page choose **copy content from another section**
(you need View access to it) or ask an administrator of the original for its reference to attach it.

## Keyboard and accessibility

Tabs support the arrow keys; the editor toolbar is reachable with Tab; dialogs ask for explicit confirmation; the
interface follows Confluence light/dark theme. English and Spanish are available (your Confluence language).

## Troubleshooting

| You see                                      | Meaning                                              | What to do                                           |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| "This section is protected"                  | You have no access                                   | Ask a section administrator                          |
| "Your access was removed"                    | A grant changed                                      | Ask an administrator; reload                         |
| "Temporarily unavailable"                    | Storage/Confluence could not be reached              | Try again; nothing was changed                       |
| "Needs attention" / corrupted                | Stored content failed integrity checks               | Contact an administrator; restore an earlier version |
| "Also requires permission to edit this page" | You have edit rights on the section but not the page | Ask for page edit permission                         |
