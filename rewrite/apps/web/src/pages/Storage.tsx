import { useEffect, useState } from 'react';
import type { StorageReport } from '@gp/sync/client';
import { listPresentations, pinnedIds } from '../db/queries.ts';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { isHostWindow } from '../hostWindow.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CARD } from '../ui/List.tsx';
import { useToast } from '../ui/Toast.tsx';

// "Lagring på den här enheten" under Mina inställningar (TODO.md "Video, and which files a device
// fetches"), as Spotify's and the iPhone's storage pages: how much the app's files use here, what is
// kept offline (each presentation, with a way to stop), and the cache, with its limit and "Rensa cache".

const LIMIT_KEY = 'gp.cacheLimit';
/** Fired when the cache limit changes in this window. */
export const CACHE_LIMIT_CHANGED = 'gp:cache-limit';
const GIB = 1024 * 1024 * 1024;
/** The limit until one is chosen (MEDIA-R14): 2 GiB. */
export const DEFAULT_CACHE_LIMIT = 2 * GIB;
/** The smallest limit the slider offers, and its step. */
const LIMIT_STEP = 128 * 1024 * 1024;

/** The cache limit this device has chosen, in bytes. */
export function cacheLimitSetting(): number {
  try {
    const v = Number(localStorage.getItem(LIMIT_KEY));
    return Number.isFinite(v) && v >= LIMIT_STEP ? v : DEFAULT_CACHE_LIMIT;
  } catch {
    return DEFAULT_CACHE_LIMIT;
  }
}

function setCacheLimitSetting(bytes: number) {
  try {
    localStorage.setItem(LIMIT_KEY, String(bytes));
  } catch {
    // Storage refused (a private window): the choice lasts until the page closes.
  }
  dispatchEvent(new Event(CACHE_LIMIT_CHANGED));
}

/** Bytes as a Swede reads them: "1,2 GB", "350 MB", "12 kB". */
export function formatBytes(bytes: number): string {
  const units: [number, string][] = [
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'kB'],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const n = bytes / size;
      return `${n.toLocaleString('sv-SE', { maximumFractionDigits: n < 10 ? 1 : 0 })} ${unit}`;
    }
  }
  return `${bytes} B`;
}

/**
 * The slider's range: from LIMIT_STEP to the room the cache could have. In the desktop app the disk's
 * free room (`fs.statfs`), in a browser the share it grants (`navigator.storage.estimate()`), as a page
 * cannot see the disk; in both plus what the cache holds now. Never below the chosen limit.
 */
async function limitRange(cache: number, chosen: number): Promise<number> {
  let room: number | null = null;
  try {
    if (window.gpDesktop?.diskSpace) room = (await window.gpDesktop.diskSpace()).free;
    else if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      room = e.quota !== undefined ? e.quota - (e.usage ?? 0) : null;
    }
  } catch {
    room = null;
  }
  const max = room === null ? 20 * GIB : room + cache;
  return Math.max(chosen, LIMIT_STEP, Math.floor(max / LIMIT_STEP) * LIMIT_STEP);
}

/** The storage report, read again whenever the database changes. */
function useStorageReport(): (StorageReport & { budget: number }) | null {
  const db = useDb();
  const [report, setReport] = useState<(StorageReport & { budget: number }) | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void db.storageReport().then((r) => live && setReport(r), () => undefined);
    load();
    const off = db.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [db]);
  return report;
}

/** "Lagring på den här enheten". A desktop host's own window keeps no files, and says so. */
export function StorageSection() {
  if (isHostWindow())
    return (
      <div className={`${CARD} p-5`} data-testid="storage">
        <h2 className="block text-sm/5 font-medium mb-1">{t('storage.title')}</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('storage.host')}</p>
      </div>
    );
  return <DeviceStorage />;
}

function DeviceStorage() {
  const db = useDb();
  const toast = useToast();
  const status = useDbStatus();
  const report = useStorageReport();
  const presentations = useData(listPresentations, []);
  const pinned = useData(pinnedIds, []);
  const [limit, setLimit] = useState(cacheLimitSetting);
  const [max, setMax] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const cache = report?.cache ?? 0;
  useEffect(() => {
    void limitRange(cache, cacheLimitSetting()).then(setMax);
  }, [cache]);
  const persistent = status?.storage === 'opfs';
  const byId = new Map((presentations ?? []).map((p) => [p.id, p]));
  return (
    <div className={`${CARD} p-5 space-y-4`} data-testid="storage">
      <div>
        <h2 className="block text-sm/5 font-medium mb-1">{t('storage.title')}</h2>
        <p className="text-sm" data-testid="storage-total">
          {report ? t('storage.used', { size: formatBytes(report.total) }) : t('storage.loading')}
        </p>
        {!!status && !persistent && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{t('storage.memory')}</p>}
      </div>

      <section aria-labelledby="storage-offline">
        <h3 id="storage-offline" className="flex items-baseline justify-between gap-2 text-sm font-medium">
          <span>{t('storage.offline')}</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums" data-testid="storage-offline-total">
            {formatBytes(report?.offlineTotal ?? 0)}
          </span>
        </h3>
        {report && !report.offline.length && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{t('storage.offlineNone')}</p>}
        <ul className="mt-2 flex flex-col gap-1" aria-label={t('storage.offline')}>
          {report?.offline.map((o) => {
            const p = byId.get(o.presentationId);
            const byHand = !!pinned?.has(o.presentationId);
            return (
              <li key={o.presentationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-neutral-100 dark:bg-neutral-700/50 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{p?.name ?? o.presentationId}</span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    {[p?.eventDate, formatBytes(o.bytes)].filter(Boolean).join(' · ')}
                    {!byHand && ` · ${t('storage.byComing')}`}
                  </span>
                </span>
                {byHand && (
                  <AppButton variant="secondary" onClick={() => void db.setPinned(o.presentationId, false)}>
                    {t('storage.stopKeeping')}
                  </AppButton>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="storage-cache" className="space-y-2">
        <h3 id="storage-cache" className="flex items-baseline justify-between gap-2 text-sm font-medium">
          <span>{t('storage.cache')}</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums" data-testid="storage-cache">
            {formatBytes(cache)}
          </span>
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('storage.cacheText')}</p>
        <label className="block text-sm">
          <span className="flex justify-between gap-2">
            <span>{t('storage.limit')}</span>
            <span className="tabular-nums" data-testid="storage-limit">
              {formatBytes(limit)}
            </span>
          </span>
          <input
            type="range"
            className="w-full accent-sky-500 cursor-pointer disabled:cursor-default"
            min={LIMIT_STEP}
            max={max ?? limit}
            step={LIMIT_STEP}
            value={limit}
            disabled={!max}
            aria-valuetext={formatBytes(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            onPointerUp={() => setCacheLimitSetting(limit)}
            onKeyUp={() => setCacheLimitSetting(limit)}
            onBlur={() => setCacheLimitSetting(limit)}
          />
        </label>
        <AppButton
          variant="secondary"
          disabled={!cache || clearing}
          onClick={async () => {
            setClearing(true);
            try {
              await db.clearCache();
              toast(t('storage.cleared'));
            } finally {
              setClearing(false);
            }
          }}
        >
          {t('storage.clear')}
        </AppButton>
      </section>
    </div>
  );
}
