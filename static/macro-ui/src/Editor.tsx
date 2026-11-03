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
  isSafeHref,
  safeValidateDoc,
  type ContentPayload,
  type RichDoc,
} from '@secure-sections/shared';
import { ApiError, unwrap, type Api } from './api';
import { useT } from './i18n';
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
  ];
}

export function EditPanel({ api, initial, onSaved, onCancel }: Props) {
  const t = useT();
  const [baseVersion, setBaseVersion] = useState(initial.version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ContentPayload | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialJson = useRef(JSON.stringify(initial.doc));
  const [words, setWords] = useState(0);

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
      const res = unwrap(await api.call('saveContent', { doc: check.doc, baseVersion }));
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
  }, [api, baseVersion, editor, onSaved, saving, t]);

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
    <section aria-label={t('editor.label')} className="ss-edit" onKeyDown={onKeyDown}>
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
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
            <RichRenderer doc={conflict.doc} />
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

function Toolbar({ editor }: { editor: Editor }) {
  const t = useT();
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);

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
      {btn(
        t('toolbar.h2'),
        editor.isActive('heading', { level: 2 }),
        () => chain().toggleHeading({ level: 2 }).run(),
        'H2',
      )}
      {btn(
        t('toolbar.h3'),
        editor.isActive('heading', { level: 3 }),
        () => chain().toggleHeading({ level: 3 }).run(),
        'H3',
      )}
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
        '❝',
      )}
      {btn(
        t('toolbar.codeBlock'),
        editor.isActive('codeBlock'),
        () => chain().toggleCodeBlock().run(),
        '{ }',
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
      {btn(t('toolbar.undo'), false, () => chain().undo().run(), <Icon>{ICONS.undo}</Icon>)}
      {btn(t('toolbar.redo'), false, () => chain().redo().run(), <Icon>{ICONS.redo}</Icon>)}
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
    </div>
  );
}
