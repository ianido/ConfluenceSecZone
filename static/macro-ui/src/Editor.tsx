import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  CHANGE_NOTE_MAX_LENGTH,
  DOC_LIMITS,
  isDataImage,
  isSafeHref,
  safeValidateDoc,
  type ContentPayload,
  type PrincipalHit,
  type RichDoc,
} from '@secure-sections/shared';
import { ApiError, safeCall, unwrap, type Api } from './api';
import { useT } from './i18n';
import { Callout, Mention, SecretField, SecureImage } from './nodes';
import { RichRenderer } from './Renderer';

interface Props {
  api: Api;
  initial: ContentPayload;
  onSaved: (c: ContentPayload) => void;
  onCancel: () => void;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const ICONS = {
  bold: <path d="M7 4h7a4 4 0 010 8H7zM7 12h8a4 4 0 010 8H7z" />,
  italic: <path d="M14 4h6M4 20h6M15 4L9 20" />,
  strike: <path d="M4 12h16M16 6c0-2-2-3-4-3S8 4 8 6s2 3 4 3M8 18c0 2 2 3 4 3s4-1 4-3" />,
  code: <path d="M8 6L2 12l6 6M16 6l6 6-6 6" />,
  bullets: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  numbers: <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 18h2M4 14h2l-2 2.5V18" />,
  link: (
    <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12 19" />
  ),
  table: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  rule: <path d="M4 12h16" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  quote: <path d="M6 16c1-4 3-6 6-6V7c-4 0-7 3-7 9zm8 0c1-4 3-6 6-6V7c-4 0-7 3-7 9z" />,
  braces: (
    <path d="M8 6C6 6 5 7 5 9v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3M16 6c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3" />
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.2" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  mention: <path d="M16 12v1.5a2.5 2.5 0 005 0V12a9 9 0 10-3.5 7.1" />,
  secret: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  callout: <path d="M12 4l8 14H4zM12 10v3M12 16h.01" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  compress: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
} as const;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function extensions() {
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url: string) => isSafeHref(url),
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Callout,
    SecureImage,
    Mention,
    SecretField,
  ];
}

function dropSlash(editor: Editor): void {
  const { $from } = editor.state.selection;
  const before = $from.parent.textContent.slice(0, $from.parentOffset);
  const at = before.lastIndexOf('/');
  if (at < 0) return;
  const from = $from.start() + at;
  editor
    .chain()
    .focus()
    .deleteRange({ from, to: from + 1 })
    .run();
}

export function EditPanel({ api, initial, onSaved, onCancel }: Props) {
  const t = useT();
  const [baseVersion, setBaseVersion] = useState(initial.version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ContentPayload | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const initialJson = useRef(JSON.stringify(initial.doc));
  const [words, setWords] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [slash, setSlash] = useState(false);

  const exts = useMemo(extensions, []);
  const editor = useEditor({
    extensions: exts,
    content: initial.doc,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'ss-editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t('editor.label'),
      },
    },
    onCreate: ({ editor: e }) => setWords(countWords(e.state.doc.textContent)),
    onUpdate: ({ editor: e }) => {
      setDirty(JSON.stringify(e.getJSON()) !== initialJson.current);
      setWords(countWords(e.state.doc.textContent));
      const { $from } = e.state.selection;
      const before = $from.parent.textContent.slice(0, $from.parentOffset);
      setSlash(/(^|\s)\/$/.test(before));
    },
  });

  useEffect(() => {
    if (!dirty) return undefined;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!editor || saving) return;
    const json = editor.getJSON();
    const check = safeValidateDoc(json);
    if (!check.ok) {
      setMessage(check.issue === 'TOO_LARGE' ? t('editor.tooLarge') : t('editor.invalid'));
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = unwrap(
        await api.call('saveContent', {
          doc: check.doc,
          baseVersion,
          ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
        }),
      );
      initialJson.current = JSON.stringify(res.content.doc);
      setDirty(false);
      setConflict(null);
      onSaved(res.content);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        const latest = await api.call('getSection', {}).catch(() => null);
        setConflict(latest && latest.state === 'READY' ? latest.content : null);
        setMessage(t('editor.conflict.title'));
      } else if (e instanceof ApiError && e.code === 'INVALID_CONTENT') {
        setMessage(t('editor.invalid'));
      } else if (e instanceof ApiError && e.code === 'PAGE_EDIT_REQUIRED') {
        setMessage(t('editor.pageEditRequired'));
      } else if (e instanceof ApiError && e.code === 'DENIED') {
        setMessage(t('state.revoked.body'));
      } else {
        setMessage(t('error.generic'));
      }
    } finally {
      setSaving(false);
    }
  }, [api, baseVersion, changeNote, editor, onSaved, saving, t]);

  const cancel = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty && !saving) void save();
    }
  };

  return (
    // The handler only adds a Ctrl+S shortcut; every action stays reachable through buttons.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-label={t('editor.label')}
      className={fullscreen ? 'ss-edit ss-fullscreen' : 'ss-edit'}
      onKeyDown={onKeyDown}
    >
      {editor && (
        <Toolbar
          editor={editor}
          api={api}
          fullscreen={fullscreen}
          slash={slash}
          onFullscreen={() => setFullscreen((v) => !v)}
          onSlashClose={() => setSlash(false)}
        />
      )}
      <EditorContent editor={editor} />
      <p className="ss-muted ss-editor-hint">{t('editor.hint')}</p>
      <label className="ss-change-note">
        {t('editor.changeNote')}
        <input
          value={changeNote}
          maxLength={CHANGE_NOTE_MAX_LENGTH}
          placeholder={t('editor.changeNote.placeholder')}
          onChange={(e) => setChangeNote(e.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="ss-actions">
        <button
          type="button"
          className="ss-btn ss-primary"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? t('editor.saving') : t('action.save')}
        </button>
        <button type="button" className="ss-btn" onClick={cancel}>
          {t('action.cancel')}
        </button>
        {dirty && !saving && <span className="ss-muted">{t('editor.unsaved')}</span>}
      </div>
      <div className="ss-statusbar ss-muted">
        <span>{t('editor.words', { count: words })}</span>
        <span>{t('editor.shortcut')}</span>
      </div>
      {confirmDiscard && (
        <div role="alertdialog" aria-label={t('editor.leaveGuard')} className="ss-callout ss-warn">
          <p>{t('editor.leaveGuard')}</p>
          <button type="button" className="ss-btn ss-danger" onClick={onCancel}>
            {t('action.discard')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setConfirmDiscard(false)}>
            {t('action.close')}
          </button>
        </div>
      )}
      <div role="status" aria-live="polite" className="ss-status">
        {message}
      </div>
      {conflict && (
        <div role="alert" className="ss-callout ss-warn">
          <h3>{t('editor.conflict.title')}</h3>
          <p>{t('editor.conflict.body')}</p>
          <details open>
            <summary>{t('editor.conflict.loadLatest')}</summary>
            <RichRenderer
              doc={conflict.doc}
              onRevealSecret={(label) => {
                void api.call('revealSecret', { label });
              }}
            />
          </details>
          <button
            type="button"
            className="ss-btn"
            onClick={() => {
              editor?.commands.setContent(conflict.doc as RichDoc);
              initialJson.current = JSON.stringify(conflict.doc);
              setBaseVersion(conflict.version);
              setDirty(false);
              setConflict(null);
              setMessage(null);
            }}
          >
            {t('editor.conflict.loadLatest')}
          </button>
          <button
            type="button"
            className="ss-btn"
            onClick={() => {
              setBaseVersion(conflict.version);
              setConflict(null);
              setMessage(null);
            }}
          >
            {t('editor.conflict.overwrite')}
          </button>
        </div>
      )}
    </section>
  );
}

function Toolbar({
  editor,
  api,
  fullscreen,
  slash,
  onFullscreen,
  onSlashClose,
}: {
  editor: Editor;
  api: Api;
  fullscreen: boolean;
  slash: boolean;
  onFullscreen: () => void;
  onSlashClose: () => void;
}) {
  const t = useT();
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHits, setMentionHits] = useState<PrincipalHit[]>([]);
  const [secretOpen, setSecretOpen] = useState(false);
  const [secretLabel, setSecretLabel] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [imagePrompt, setImagePrompt] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headingLevel = editor.isActive('heading')
    ? String(editor.getAttributes('heading').level ?? '0')
    : '0';

  const insertBlock = (node: Record<string, unknown>) => {
    dropSlash(editor);
    editor.chain().focus().insertContent(node).run();
    onSlashClose();
  };

  const btn = (label: string, active: boolean, run: () => void, glyph: ReactNode) => (
    <button
      type="button"
      className="ss-tool"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={run}
    >
      {glyph}
    </button>
  );
  const chain = () => editor.chain().focus();

  return (
    <div role="toolbar" aria-label={t('editor.label')} className="ss-toolbar">
      {btn(
        t('toolbar.bold'),
        editor.isActive('bold'),
        () => chain().toggleBold().run(),
        <Icon>{ICONS.bold}</Icon>,
      )}
      {btn(
        t('toolbar.italic'),
        editor.isActive('italic'),
        () => chain().toggleItalic().run(),
        <Icon>{ICONS.italic}</Icon>,
      )}
      {btn(
        t('toolbar.strike'),
        editor.isActive('strike'),
        () => chain().toggleStrike().run(),
        <Icon>{ICONS.strike}</Icon>,
      )}
      {btn(
        t('toolbar.code'),
        editor.isActive('code'),
        () => chain().toggleCode().run(),
        <Icon>{ICONS.code}</Icon>,
      )}
      <label className="ss-heading-select">
        <span className="ss-sr">{t('toolbar.heading')}</span>
        <select
          aria-label={t('toolbar.heading')}
          value={headingLevel}
          onChange={(e) => {
            const level = Number(e.target.value);
            if (level === 0) chain().setParagraph().run();
            else
              chain()
                .toggleHeading({ level: level as 1 | 2 | 3 | 4 })
                .run();
          }}
        >
          <option value="0">{t('toolbar.paragraph')}</option>
          <option value="1">{t('toolbar.h1')}</option>
          <option value="2">{t('toolbar.h2')}</option>
          <option value="3">{t('toolbar.h3')}</option>
          <option value="4">{t('toolbar.h4')}</option>
        </select>
      </label>
      {btn(
        t('toolbar.bullets'),
        editor.isActive('bulletList'),
        () => chain().toggleBulletList().run(),
        <Icon>{ICONS.bullets}</Icon>,
      )}
      {btn(
        t('toolbar.numbers'),
        editor.isActive('orderedList'),
        () => chain().toggleOrderedList().run(),
        <Icon>{ICONS.numbers}</Icon>,
      )}
      {btn(
        t('toolbar.quote'),
        editor.isActive('blockquote'),
        () => chain().toggleBlockquote().run(),
        <Icon>{ICONS.quote}</Icon>,
      )}
      {btn(
        t('toolbar.codeBlock'),
        editor.isActive('codeBlock'),
        () => chain().toggleCodeBlock().run(),
        <Icon>{ICONS.braces}</Icon>,
      )}
      {btn(
        t('toolbar.link'),
        editor.isActive('link'),
        () => setLinkInput(editor.getAttributes('link').href ?? ''),
        <Icon>{ICONS.link}</Icon>,
      )}
      {btn(
        t('toolbar.table'),
        editor.isActive('table'),
        () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        <Icon>{ICONS.table}</Icon>,
      )}
      {btn(
        t('toolbar.rule'),
        false,
        () => chain().setHorizontalRule().run(),
        <Icon>{ICONS.rule}</Icon>,
      )}
      {btn(
        t('toolbar.callout'),
        editor.isActive('callout'),
        () =>
          insertBlock({
            type: 'callout',
            attrs: { tone: 'info' },
            content: [{ type: 'paragraph' }],
          }),
        <Icon>{ICONS.callout}</Icon>,
      )}
      {btn(t('toolbar.image'), imagePrompt, () => setImagePrompt(true), <Icon>{ICONS.image}</Icon>)}
      {btn(
        t('toolbar.mention'),
        mentionQuery !== null,
        () => setMentionQuery(''),
        <Icon>{ICONS.mention}</Icon>,
      )}
      {btn(t('toolbar.secret'), secretOpen, () => setSecretOpen(true), <Icon>{ICONS.secret}</Icon>)}
      {btn(
        fullscreen ? t('toolbar.exitFullscreen') : t('toolbar.fullscreen'),
        fullscreen,
        onFullscreen,
        <Icon>{fullscreen ? ICONS.compress : ICONS.expand}</Icon>,
      )}
      {btn(t('toolbar.undo'), false, () => chain().undo().run(), <Icon>{ICONS.undo}</Icon>)}
      {btn(t('toolbar.redo'), false, () => chain().redo().run(), <Icon>{ICONS.redo}</Icon>)}
      {imagePrompt && (
        <div className="ss-image-prompt">
          <label>
            {t('image.alt')}
            <input
              value={imageAlt}
              maxLength={DOC_LIMITS.maxAltLength}
              placeholder={t('image.alt')}
              aria-label={t('image.alt')}
              onChange={(e) => setImageAlt(e.target.value)}
            />
          </label>
          <button type="button" className="ss-btn" onClick={() => fileRef.current?.click()}>
            {t('image.choose')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setImagePrompt(false)}>
            {t('action.close')}
          </button>
          {imageError && <span role="alert">{imageError}</span>}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="ss-sr"
            aria-label={t('image.file')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
                setImageError(t('image.invalid'));
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const src = typeof reader.result === 'string' ? reader.result : '';
                if (!isDataImage(src) || src.length > DOC_LIMITS.maxImageSrcLength) {
                  setImageError(t('image.tooLarge'));
                  return;
                }
                setImageError(null);
                setImagePrompt(false);
                setImageAlt('');
                editor
                  .chain()
                  .focus()
                  .insertContent({ type: 'image', attrs: { src, alt: imageAlt.trim() } })
                  .run();
              };
              reader.readAsDataURL(file);
            }}
          />
        </div>
      )}
      <div className="ss-slash" role="menu" aria-label={t('toolbar.slash')} hidden={!slash}>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            dropSlash(editor);
            chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            onSlashClose();
          }}
        >
          {t('slash.table')}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            dropSlash(editor);
            chain().toggleCodeBlock().run();
            onSlashClose();
          }}
        >
          {t('slash.code')}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            insertBlock({
              type: 'callout',
              attrs: { tone: 'warn' },
              content: [{ type: 'paragraph' }],
            })
          }
        >
          {t('slash.callout')}
        </button>
      </div>
      {linkInput !== null && (
        <form
          className="ss-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            const value = linkInput.trim();
            if (value === '') {
              chain().extendMarkRange('link').unsetLink().run();
            } else if (isSafeHref(value)) {
              chain().extendMarkRange('link').setLink({ href: value }).run();
            } else {
              setLinkError(true);
              return;
            }
            setLinkError(false);
            setLinkInput(null);
          }}
        >
          <label>
            {t('link.prompt')}
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              aria-invalid={linkError}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </label>
          {linkError && <span role="alert">{t('link.invalid')}</span>}
          <button type="submit" className="ss-btn">
            {t('action.confirm')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setLinkInput(null)}>
            {t('action.cancel')}
          </button>
        </form>
      )}
      {mentionQuery !== null && (
        <form
          className="ss-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            void safeCall(api, 'searchPrincipals', { query: mentionQuery, type: 'USER' }).then(
              (res) => {
                if (res.ok) setMentionHits(res.data.hits);
              },
            );
          }}
        >
          <p className="ss-muted">{t('mention.note')}</p>
          <label>
            {t('mention.search')}
            <input
              type="search"
              value={mentionQuery}
              onChange={(e) => setMentionQuery(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </label>
          <button type="submit" className="ss-btn" disabled={mentionQuery.trim().length < 2}>
            {t('mention.search')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setMentionQuery(null)}>
            {t('action.cancel')}
          </button>
          <ul className="ss-hits">
            {mentionHits.map((h) => (
              <li key={h.principalId}>
                <button
                  type="button"
                  className="ss-btn"
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: 'mention',
                        attrs: { accountId: h.principalId, label: h.label },
                      })
                      .run();
                    setMentionQuery(null);
                    setMentionHits([]);
                  }}
                >
                  @{h.label}
                </button>
              </li>
            ))}
          </ul>
        </form>
      )}
      {secretOpen && (
        <form
          className="ss-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            const label = secretLabel.trim();
            const value = secretValue;
            if (!label || !value || value.length > DOC_LIMITS.maxSecretValue) return;
            editor.chain().focus().insertContent({ type: 'secret', attrs: { label, value } }).run();
            setSecretLabel('');
            setSecretValue('');
            setSecretOpen(false);
          }}
        >
          <label>
            {t('secret.label')}
            <input
              value={secretLabel}
              maxLength={DOC_LIMITS.maxSecretLabel}
              onChange={(e) => setSecretLabel(e.target.value)}
              required
            />
          </label>
          <label>
            {t('secret.value')}
            <input
              type="password"
              value={secretValue}
              maxLength={DOC_LIMITS.maxSecretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <button type="submit" className="ss-btn">
            {t('secret.insert')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setSecretOpen(false)}>
            {t('action.cancel')}
          </button>
        </form>
      )}
    </div>
  );
}
