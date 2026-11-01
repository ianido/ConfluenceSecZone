# Scopes and permissions rationale

| Scope                                | Used for                                                                                                                        | Why not less                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `storage:app`                        | Custom Entity Store (`ssdoc`)                                                                                                   | Required for any Forge-hosted storage                                                                                       |
| `read:confluence-content.permission` | `POST /wiki/rest/api/content/{id}/permission/check` as the invoking user (read, update on the current page)                     | The only API that evaluates site, space and restriction rules together                                                      |
| `read:content-details:confluence`    | Content lookups needed alongside permission checks and diagnostics                                                              | Granular companion scope used with restrictions API; to be re-evaluated after `forge lint` (spike S7) and removed if unused |
| `read:confluence-user`               | Directory search for people, bulk user lookup, current user details (site admin detection for recovery/diagnostics), `memberof` | Required to grant by person and resolve membership                                                                          |
| `read:confluence-groups`             | Group search, group by id, group members (for "empty admin group" detection)                                                    | Required to grant by group                                                                                                  |
| `report:personal-data`               | Atlassian Privacy API reporting of stored accountIds                                                                            | Mandatory for apps storing personal data                                                                                    |

Not requested: any write scope to Confluence content, any `external` egress, `read:app-system-token`/`read:app-user-token` (Forge Remote).

Principles: the user's own page rights are checked as the user (`asUser`) before any `asApp` call; `asApp` only reads directory
data (names, memberships), never page content. Every addition of a scope needs a major version and admin re-consent, so scope
review is part of docs/DEPLOYMENT.md. `scripts/validate-manifest.mjs` fails if an unlisted scope is added.

Status: scope-to-endpoint mapping is derived from documentation; confirmation by `forge lint` and a live site is spike S7 (NOT EXECUTED).
