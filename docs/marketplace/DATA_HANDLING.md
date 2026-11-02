# Data handling overview (DRAFT, for legal review)

| Data                                                                          | Where                                                           | Why                   | Retention                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| Protected section content (rich text JSON)                                    | Forge-hosted Custom Entity Store of the customer's installation | The product's purpose | Until section deleted (+30 days grace)             |
| Content revisions                                                             | same                                                            | History and restore   | Max 50 and 365 days by default; head revision kept |
| Access control list (Atlassian accountIds and group ids with role)            | same                                                            | Authorization         | Life of the section                                |
| Audit entries (action, accountId, minimal metadata, hash)                     | same                                                            | Accountability        | 730 days by default                                |
| Section/page/macro identifiers (page id, macro local id, cloud id, space key) | same                                                            | Binding               | Life of the section                                |
| Logs (event names, error classes)                                             | Forge platform logs                                             | Operations            | Per Atlassian                                      |

- The app stores no names or email addresses; display names are read live from Confluence when shown.
- No data is sent to the vendor or any third party. No analytics. No external services or subprocessors.
- Atlassian is the infrastructure provider (Forge). Data residency follows Forge's realm/residency model for the host product (verify and quote Atlassian's current statement).
- Personal-data reporting: accountIds are reported to Atlassian via the Privacy API on at least a 7-day cycle; closed accounts are anonymised.
- Customer-generated content may contain any category of personal data; the controller is the customer.
- End users cannot export their personal data themselves (manual operator process, docs/OPERATIONS.md).
