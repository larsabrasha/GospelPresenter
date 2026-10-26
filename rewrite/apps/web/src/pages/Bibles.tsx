import { useState, type DragEvent } from 'react';
import { BIBLE_ZIP_MAX_BYTES } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listBibles, type InstalledBible } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { Button } from '../ui/Button.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { useToast } from '../ui/Toast.tsx';

type Message = { ok: boolean; text: string } | null;

/**
 * Biblar (spec 05 `/admin/bibles`): import a translation from a zip, list
 * them, delete one. Admins only (D24). The zip is read on this device; its
 * text is uploaded once and every device fetches it once (README, "Bibles").
 */
export function Bibles() {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const bibles = useData(listBibles, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [dragging, setDragging] = useState(false);

  const importFile = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith('.zip')) return setMessage({ ok: false, text: t('bibles.onlyZip') });
    if (file.size > BIBLE_ZIP_MAX_BYTES) return setMessage({ ok: false, text: t('bibles.failed', { error: t('bibles.tooLarge') }) });
    setBusy(true);
    setMessage(null);
    try {
      const r = await db.importBible(new Uint8Array(await file.arrayBuffer()));
      const done = t(r.replaced ? 'bibles.updated' : 'bibles.imported', { name: r.name, n: r.verses.toLocaleString('sv-SE') });
      setMessage({ ok: true, text: r.queued ? `${done} ${t('bibles.queued')}` : done });
    } catch (e) {
      setMessage({ ok: false, text: t('bibles.failed', { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: InstalledBible) => {
    if (!(await ask({ title: t('bibles.deleteTitle'), text: t('bibles.deleteConfirm', { name: b.name }), confirm: t('common.delete') }))) return;
    await db.mutate('deleteBible', { id: b.id });
    toast(t('bibles.deleted'));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFile(e.dataTransfer.files[0]);
  };

  return (
    <section
      className={dragging ? 'drop-zone dragging' : 'drop-zone'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dialog}
      <h1>{t('bibles.title')}</h1>
      {dragging && <p className="drop-hint">{t('bibles.dropHere')}</p>}
      <div className="card">
        <h2>{t('bibles.importTitle')}</h2>
        <p className="muted">{t('bibles.importText')}</p>
        <div className="row">
          <label className={busy ? 'btn btn-primary disabled' : 'btn btn-primary'}>
            {busy ? t('bibles.importing') : t('bibles.chooseFile')}
            <input
              type="file"
              accept=".zip"
              hidden
              disabled={busy}
              data-testid="bible-file"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <span className="muted small">{t('bibles.orDrop')}</span>
        </div>
        {busy && (
          <p className="muted" role="status">
            {t('bibles.processing')} <progress />
          </p>
        )}
        {message && (
          <p className={message.ok ? 'ok' : 'danger'} role="status" data-testid="bible-import-message">
            {message.text}
          </p>
        )}
      </div>
      <div className="card">
        <h2>{t('bibles.installed', { count: bibles?.length ?? 0 })}</h2>
        {bibles && !bibles.length && <p className="muted">{t('bibles.empty')}</p>}
        <ul className="list" aria-label={t('bibles.title')}>
          {bibles?.map((b) => (
            <li key={b.id} className="row">
              <span className="grow">
                <strong>{b.name}</strong>
                <br />
                <span className="muted">{t('bibles.row', { abbreviation: b.abbreviation, n: b.verseCount.toLocaleString('sv-SE') })}</span>
              </span>
              <span className={b.stored ? 'ok small' : 'muted small'}>{b.stored ? t('bibles.offline') : t('bibles.fetching')}</span>
              <Button variant="danger" aria-label={`${t('common.delete')} ${b.name}`} onClick={() => void remove(b)}>
                ×
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
