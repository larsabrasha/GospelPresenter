import { useEffect, useState } from 'react';
import type { StorageReport } from '@gp/sync/client';
import { listPresentations, pinnedIds } from '../db/queries.ts';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { isHostWindow } from '../hostWindow.ts';
import { locale, t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { ACTION_ROW, GROUP_ROW, Group, OpeningRow, PopUp, SwitchRow } from '../ui/Group.tsx';
import { setKeepComingSetting, useKeepComing } from '../ui/KeepOffline.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { formatBytes } from '../ui/formatBytes.ts';

// Lagring (`/storage`, TODO.md "Video, and which files a device fetches"): a page of its own under Mina
// inställningar, as the iPhone's iPhone-lagring under Allmänt (Lars, 2026-11-03). The switch that keeps the coming
// presentations, what is kept offline (each presentation, with a way to stop), and the cache, with its limit and
// "Rensa cache"; short texts, and nothing the user cannot act on (Lars, 2026-11-03).

const LIMIT_KEY = 'gp.cacheLimit';
/** Fired when the cache limit changes in this window. */
export const CACHE_LIMIT_CHANGED = 'gp:cache-limit';
const GIB = 1024 * 1024 * 1024;
/** The limit until one is chosen (MEDIA-R14): 2 GiB. */
const DEFAULT_CACHE_LIMIT = 2 * GIB;
/** The smallest limit a device may have. */
const LIMIT_STEP = 128 * 1024 * 1024;
/** The limits the menu offers, as iOS offers a few fixed choices rather than a slider (Lars, 2026-11-01). */
const LIMITS = [0.5, 1, 2, 5, 10, 20, 50, 100].map((n) => n * GIB);

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

/** A limit in the menu: "512 MB", "2 GB" (the binary sizes the limits are, named as people know them). */
function limitLabel(bytes: number): string {
  const [n, unit] = bytes < GIB ? [bytes / (1024 * 1024), 'MB'] : [bytes / GIB, 'GB'];
  const size = `${n.toLocaleString(locale(), { maximumFractionDigits: 2 })} ${unit}`;
  return bytes === DEFAULT_CACHE_LIMIT ? t('storage.limitDefault', { size }) : size;
}

/**
 * The largest limit the menu offers: the room the cache could have. In the desktop app the disk's
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

/** Lagring's row in Mina inställningar, with no size: nothing the user acts on (Lars, 2026-11-03). */
export function StorageRow() {
  return <OpeningRow label={t('storage.title')} href={href({ page: 'storage' })} />;
}

/** The page. A desktop host's own window keeps no files, and says so. */
export function Storage() {
  return (
    <PageContainer>
      <PageHeader title={t('storage.title')} />
      {isHostWindow() ? (
        <div data-testid="storage">
          <Group>
            <p className="px-4 py-3 text-sm text-stone-500 dark:text-stone-400">{t('storage.host')}</p>
          </Group>
        </div>
      ) : (
        <DeviceStorage />
      )}
    </PageContainer>
  );
}

/**
 * "Spara kommande presentationer offline" (TODO.md "Video"): this device keeps every presentation of the
 * coming seven days offline, videos too, as if each had been chosen by hand. Off at first. A device that
 * keeps nothing says why here, the one place it is said on this page.
 */
function KeepComing() {
  const on = useKeepComing();
  const status = useDbStatus();
  const unavailable = !!status && status.storage !== 'opfs';
  return (
    <SwitchRow
      title={t('settings.keepComing')}
      description={t(unavailable ? 'offline.unavailable' : 'settings.keepComingDescription')}
      checked={on && !unavailable}
      disabled={unavailable}
      onChange={setKeepComingSetting}
    />
  );
}

function DeviceStorage() {
  const db = useDb();
  const toast = useToast();
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
  const byId = new Map((presentations ?? []).map((p) => [p.id, p]));
  return (
    <div className="space-y-6" data-testid="storage">
      <Group>
        <KeepComing />
      </Group>

      <Group title={t('storage.offline')}>
        {report && !report.offline.length && <p className={`${GROUP_ROW} text-stone-500 dark:text-stone-400`}>{t('storage.offlineNone')}</p>}
        {!!report?.offline.length && (
          <div className={GROUP_ROW}>
            <span>{t('storage.offlineTotal')}</span>
            <span className="tabular-nums text-stone-500 dark:text-stone-400" data-testid="storage-offline-total">
              {formatBytes(report.offlineTotal)}
            </span>
          </div>
        )}
        {!!report?.offline.length && (
          <ul className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator" aria-label={t('storage.offline')}>
            {report.offline.map((o) => {
              const p = byId.get(o.presentationId);
              const byHand = !!pinned?.has(o.presentationId);
              return (
                <li key={o.presentationId} className={GROUP_ROW}>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{p?.name ?? o.presentationId}</span>
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {[p?.eventDate, formatBytes(o.bytes)].filter(Boolean).join(' · ')}
                      {!byHand && ` · ${t('storage.byComing')}`}
                    </span>
                  </span>
                  {byHand && (
                    <AppButton variant="plain" className="shrink-0 text-sky-600 dark:text-sky-400 cursor-pointer hover:underline" onClick={() => void db.setPinned(o.presentationId, false)}>
                      {t('storage.stopKeeping')}
                    </AppButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group title={t('storage.cache')} footer={t('storage.cacheText')}>
        <div className={GROUP_ROW}>
          <span>{t('storage.cacheUsed')}</span>
          <span className="tabular-nums text-stone-500 dark:text-stone-400" data-testid="storage-cache">
            {formatBytes(cache)}
          </span>
        </div>
        <label className={GROUP_ROW}>
          <span>{t('storage.limit')}</span>
          {/* The limits that fit in the room the cache could have, and the one chosen, which an earlier slider may have left between them. */}
          <PopUp
            value={limit}
            disabled={!max}
            data-testid="storage-limit"
            onChange={(e) => {
              const bytes = Number(e.target.value);
              setLimit(bytes);
              setCacheLimitSetting(bytes);
            }}
          >
            {[...new Set([...LIMITS.filter((l) => l <= (max ?? limit)), limit])]
              .toSorted((a, b) => a - b)
              .map((l) => (
                <option key={l} value={l}>
                  {limitLabel(l)}
                </option>
              ))}
          </PopUp>
        </label>
        {/* Rensa cache as a row in sky, as iOS's actions in a group. */}
        <AppButton
          variant="plain"
          className={ACTION_ROW}
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
      </Group>
    </div>
  );
}
