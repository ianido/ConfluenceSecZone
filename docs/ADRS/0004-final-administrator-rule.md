# ADR-0004: Final administrator rule

Status: accepted

At least one **direct user** administrator must always remain. A group ADMINISTER grant does not count as a
surviving administrator (groups can be deleted or emptied by third parties). Removing or downgrading the last
direct administrator is refused. The check runs inside the optimistic-concurrency retry loop with the section
`rev` as the transaction condition, so two concurrent removals cannot both pass (`permissions.test.ts` race
tests). Ownership follows: revoking the owner reassigns ownership to a remaining administrator.

Limit: relies on KVS conditional transactions behaving as documented (S5, NOT EXECUTED).
