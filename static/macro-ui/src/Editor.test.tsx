import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t as translate, type ContentPayload } from '@secure-sections/shared';
import { EditPanel } from './Editor';
import { readyView, renderWithI18n, scriptedApi } from './testing';

const initial = (readyView() as { content: ContentPayload }).content;
const hrLabel = translate('en', 'toolbar.rule');

describe('EditPanel', () => {
  it('starts clean, becomes dirty after a toolbar action, and saves a validated document', async () => {
    const saved = vi.fn();
    const api = scriptedApi({
      saveContent: (p) => ({
        ok: true,
        data: {
          content: { ...initial, doc: (p as { doc: ContentPayload['doc'] }).doc, version: 2 },
        },
      }),
    });
    renderWithI18n(<EditPanel api={api} initial={initial} onSaved={saved} onCancel={() => {}} />);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: hrLabel }));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(save);

    await waitFor(() => expect(saved).toHaveBeenCalled());
    const call = api.calls.find((c) => c.fn === 'saveContent');
    expect(call?.payload).toMatchObject({ baseVersion: 1 });
    expect(JSON.stringify(call?.payload)).toContain('horizontalRule');
    expect(Object.keys(call?.payload as object).sort()).toEqual(['baseVersion', 'doc']);
  });

  it('sends an optional change note with the save', async () => {
    const saved = vi.fn();
    const api = scriptedApi({
      saveContent: (p) => ({
        ok: true,
        data: {
          content: { ...initial, doc: (p as { doc: ContentPayload['doc'] }).doc, version: 2 },
        },
      }),
    });
    renderWithI18n(<EditPanel api={api} initial={initial} onSaved={saved} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: hrLabel }));
    fireEvent.change(screen.getByRole('textbox', { name: /What changed/ }), {
      target: { value: 'raise Technology' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.calls.find((c) => c.fn === 'saveContent')?.payload).toMatchObject({
      changeNote: 'raise Technology',
    });
  });

  it('shows a word count and saves with Ctrl+S only when there are changes', async () => {
    const saved = vi.fn();
    const api = scriptedApi({
      saveContent: (p) => ({
        ok: true,
        data: {
          content: { ...initial, doc: (p as { doc: ContentPayload['doc'] }).doc, version: 2 },
        },
      }),
    });
    renderWithI18n(<EditPanel api={api} initial={initial} onSaved={saved} onCancel={() => {}} />);
    await screen.findByRole('button', { name: 'Save' });
    expect(await screen.findByText('2 words')).toBeTruthy();

    screen.getByRole('textbox', { name: 'Protected content editor' }).focus();
    await userEvent.keyboard('{Control>}s{/Control}');
    expect(api.calls.filter((c) => c.fn === 'saveContent')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: hrLabel }));
    await userEvent.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.calls.filter((c) => c.fn === 'saveContent')).toHaveLength(1);
  });

  it('conflict: shows latest-version choices instead of silently overwriting', async () => {
    const api = scriptedApi({
      saveContent: () => ({ ok: false, code: 'CONFLICT' }),
      getSection: () =>
        readyView({
          content: { ...initial, version: 5, updatedBy: { accountId: 'b', displayName: 'Bob' } },
        }),
    });
    renderWithI18n(
      <EditPanel api={api} initial={initial} onSaved={() => {}} onCancel={() => {}} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: hrLabel }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText(/changed|conflict/i)).not.toHaveLength(0);
  });

  it('cancel with unsaved changes asks for confirmation first', async () => {
    const cancelled = vi.fn();
    renderWithI18n(
      <EditPanel api={scriptedApi({})} initial={initial} onSaved={() => {}} onCancel={cancelled} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: hrLabel }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelled).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
