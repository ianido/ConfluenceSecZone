import { useState } from 'react';
import {
  CLASSIFICATIONS,
  TITLE_MAX_LENGTH,
  isClassification,
  type Classification,
  type SectionMeta,
} from '@secure-sections/shared';
import { ApiError, unwrap, type Api } from './api';
import { useT } from './i18n';

export function ClassificationBadge({ value }: { value: Classification | null }) {
  const t = useT();
  if (!value) return null;
  return <span className={`ss-badge ss-class-${value.toLowerCase()}`}>{t(`class.${value}`)}</span>;
}

/** Title, classification badge and access summary shown above the tabs. */
export function SectionHeader({
  api,
  meta,
  canAdminister,
  editingLocked,
  onMeta,
  onManage,
}: {
  api: Api;
  meta: SectionMeta;
  canAdminister: boolean;
  editingLocked: boolean;
  onMeta: (m: SectionMeta) => void;
  onManage: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(meta.title ?? '');
  const [classification, setClassification] = useState<Classification | ''>(
    meta.classification ?? '',
  );
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const next = unwrap(
        await api.call('updateMetadata', {
          title: title.trim() === '' ? null : title.trim(),
          classification: classification === '' ? null : classification,
        }),
      );
      onMeta(next);
      setEditing(false);
      setNotice({ ok: true, text: t('meta.saved') });
    } catch (e) {
      setNotice({
        ok: false,
        text: e instanceof ApiError && e.code === 'DENIED' ? t('error.denied') : t('error.generic'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="ss-header">
      <div className="ss-header-main">
        <h2 className="ss-header-title">
          <span aria-hidden="true">🔒 </span>
          {meta.title ?? t('header.default')}
        </h2>
        <ClassificationBadge value={meta.classification} />
        <span className="ss-header-spacer" />
        <span className="ss-muted ss-header-shared">
          {t('header.shared', { users: meta.sharedWith.users, groups: meta.sharedWith.groups })}
        </span>
        {canAdminister && (
          <>
            <button
              type="button"
              className="ss-btn ss-small"
              disabled={editingLocked}
              onClick={onManage}
            >
              {t('header.manage')}
            </button>
            <button
              type="button"
              className="ss-btn ss-small"
              disabled={editingLocked || editing}
              onClick={() => {
                setTitle(meta.title ?? '');
                setClassification(meta.classification ?? '');
                setNotice(null);
                setEditing(true);
              }}
            >
              {t('meta.edit')}
            </button>
          </>
        )}
      </div>
      {editing && (
        <form
          className="ss-meta-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            {t('meta.title.label')}
            <input
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              placeholder={t('meta.title.placeholder')}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            {t('meta.class.label')}
            <select
              value={classification}
              onChange={(e) => {
                const v = e.target.value;
                setClassification(isClassification(v) ? v : '');
              }}
            >
              <option value="">{t('meta.class.none')}</option>
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`class.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="ss-muted ss-meta-note">{t('meta.public.note')}</p>
          <div className="ss-actions">
            <button type="submit" className="ss-btn ss-primary" disabled={busy}>
              {t('action.save')}
            </button>
            <button type="button" className="ss-btn" onClick={() => setEditing(false)}>
              {t('action.cancel')}
            </button>
          </div>
        </form>
      )}
      <div role="status" aria-live="polite">
        {notice && <p className={notice.ok ? 'ss-ok' : 'ss-err'}>{notice.text}</p>}
      </div>
    </header>
  );
}
