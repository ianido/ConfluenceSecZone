import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    onUpdate: ({ editor: e }) => setDirty(JSON.stringify(e.getJSON()) !== initialJson.current),
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

  return (
    <section aria-label={t('editor.label')} className="ss-edit">
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

  const btn = (label: string, active: boolean, run: () => void, glyph: string) => (
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
      {btn(t('toolbar.bold'), editor.isActive('bold'), () => chain().toggleBold().run(), 'B')}
      {btn(t('toolbar.italic'), editor.isActive('italic'), () => chain().toggleItalic().run(), 'I')}
      {btn(t('toolbar.strike'), editor.isActive('strike'), () => chain().toggleStrike().run(), 'S')}
      {btn(t('toolbar.code'), editor.isActive('code'), () => chain().toggleCode().run(), '</>')}
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
        '•',
      )}
      {btn(
        t('toolbar.numbers'),
        editor.isActive('orderedList'),
        () => chain().toggleOrderedList().run(),
        '1.',
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
        '🔗',
      )}
      {btn(
        t('toolbar.table'),
        editor.isActive('table'),
        () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        '▦',
      )}
      {btn(t('toolbar.rule'), false, () => chain().setHorizontalRule().run(), '—')}
      {btn(t('toolbar.undo'), false, () => chain().undo().run(), '↶')}
      {btn(t('toolbar.redo'), false, () => chain().redo().run(), '↷')}
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
