export const ROLES = ['VIEW', 'MODIFY', 'ADMINISTER'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { VIEW: 1, MODIFY: 2, ADMINISTER: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** VIEW < MODIFY < ADMINISTER. MODIFY implies VIEW; ADMINISTER implies MODIFY. */
export function roleAtLeast(actual: Role | null | undefined, required: Role): boolean {
  if (!actual) return false;
  return RANK[actual] >= RANK[required];
}

export function maxRole(roles: Iterable<Role>): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (best === null || RANK[r] > RANK[best]) best = r;
  }
  return best;
}

export const PRINCIPAL_TYPES = ['USER', 'GROUP'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export function isPrincipalType(value: unknown): value is PrincipalType {
  return typeof value === 'string' && (PRINCIPAL_TYPES as readonly string[]).includes(value);
}
