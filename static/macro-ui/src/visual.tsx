import type { ReactNode } from 'react';
import type { SectionTemplate } from '@secure-sections/shared';

/** Decorative icons and chips that follow the site mockups. Names stay in the accessible text. */

function Mark({ children, className = 'ss-ico' }: { children: ReactNode; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {children}
      </svg>
    </span>
  );
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function LockIcon({ large = false }: { large?: boolean }) {
  return (
    <Mark className={large ? 'ss-ico ss-ico-lg' : 'ss-ico'}>
      <rect x="5" y="11" width="14" height="10" rx="2" {...STROKE} />
      <path d="M8 11V8a4 4 0 018 0v3" {...STROKE} />
    </Mark>
  );
}

export function GearIcon() {
  return (
    <Mark>
      <circle cx="12" cy="12" r="3" {...STROKE} />
      <path
        d="M12 3v2M12 19v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2M19 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"
        {...STROKE}
      />
    </Mark>
  );
}

export function EyeIcon() {
  return (
    <Mark>
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" {...STROKE} />
      <circle cx="12" cy="12" r="2.5" {...STROKE} />
    </Mark>
  );
}

export function CopyIcon() {
  return (
    <Mark>
      <rect x="8" y="8" width="12" height="12" rx="2" {...STROKE} />
      <path d="M4 16V6a2 2 0 012-2h10" {...STROKE} />
    </Mark>
  );
}

export function HourglassIcon() {
  return (
    <Mark>
      <path d="M7 4h10M7 20h10M8 4c0 4 8 4 8 8s-8 4-8 8M16 4c0 4-8 4-8 8s8 4 8 8" {...STROKE} />
    </Mark>
  );
}

function DocIcon() {
  return (
    <Mark className="ss-ico ss-ico-lg">
      <path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" {...STROKE} />
      <path d="M14 3v6h6M8 13h8M8 17h5" {...STROKE} />
    </Mark>
  );
}

function KeyIcon() {
  return (
    <Mark className="ss-ico ss-ico-lg">
      <circle cx="8" cy="14" r="4" {...STROKE} />
      <path d="M11 12l9-9M16 7l3 3M14 5l2 2" {...STROKE} />
    </Mark>
  );
}

function PeopleIcon() {
  return (
    <Mark className="ss-ico ss-ico-lg">
      <circle cx="9" cy="8" r="3" {...STROKE} />
      <path d="M3 19c1-3 3.5-4.5 6-4.5S14 16 15 19" {...STROKE} />
      <circle cx="17" cy="9" r="2" {...STROKE} />
      <path d="M16 14.5c2 .4 3.5 1.6 4.5 4.5" {...STROKE} />
    </Mark>
  );
}

function ClipboardIcon() {
  return (
    <Mark className="ss-ico ss-ico-lg">
      <rect x="6" y="5" width="12" height="16" rx="2" {...STROKE} />
      <path d="M9 5V4a2 2 0 012-2h2a2 2 0 012 2v1M9 12h6M9 16h4" {...STROKE} />
    </Mark>
  );
}

const TEMPLATE_ICON: Record<SectionTemplate, () => ReactNode> = {
  blank: DocIcon,
  credentials: KeyIcon,
  hr: PeopleIcon,
  minutes: ClipboardIcon,
};

export function TemplateMark({ id }: { id: SectionTemplate }) {
  const Icon = TEMPLATE_ICON[id];
  return <Icon />;
}

const AVATAR_COLORS = ['#6554c0', '#36b37e', '#0c66e4', '#ff8b00', '#ff5630', '#00b8d9', '#403294'];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="ss-avatar" style={{ background: colorFor(name) }} title={name}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names }: { names: string[] }) {
  const shown = names.slice(0, 3);
  const extra = names.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <span className="ss-faces" aria-hidden="true">
      {shown.map((name, i) => (
        <Avatar key={`${name}-${i}`} name={name} />
      ))}
      {extra > 0 && <span className="ss-avatar ss-avatar-more">+{extra}</span>}
    </span>
  );
}

/** Colored circles for a known count when the names themselves are not on this screen. */
export function CountFaces({ users, groups }: { users: number; groups: number }) {
  const shown = Math.min(Math.max(users, 0), 3);
  const extra = Math.max(users - shown, 0);
  if (shown === 0 && groups === 0) return null;
  return (
    <span className="ss-faces" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="ss-avatar" style={{ background: AVATAR_COLORS[i] }} />
      ))}
      {groups > 0 && <span className="ss-avatar ss-avatar-group">G</span>}
      {extra > 0 && <span className="ss-avatar ss-avatar-more">+{extra}</span>}
    </span>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted' | 'owner' | 'group';
  children: ReactNode;
}) {
  return <span className={`ss-pill ss-pill-${tone}`}>{children}</span>;
}
