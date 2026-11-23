// The scenarios (docs/view-models.md): a small organisation made by the mutators in a database in memory, for the
// core's own scenario test and for each shell's test of what it draws against the same answers
// (scenarios/<name>.expected.json). Node only: node:sqlite.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Core, runMutation, type Rows } from '../core.ts';

/** A scenario as its file has it: the organisation's mutations, presenting's states by their keys, the additions asked. */
export interface Scenario {
  presentation: string;
  /** Another presentation, which may not start while the first is presented. */
  other: string;
  setup: [string, object][];
  states: { name: string; presenting: boolean; keys: object[] }[];
  /** The page's events played from each state (`pageEventView`). */
  keys: object[];
  adds: object[];
}

/** An item of the page, as `presentationPageView` gives it. */
export interface ScenarioItem { id: string; type: string; sourceId: string; title: string; arrangementId: string | null; overlayId: string | null }

/** The presentation's page as the shells read it (`presentationPageView`). */
export interface ScenarioPage {
  items: ScenarioItem[];
  slides: Record<string, { slides: unknown[] }>;
  songs: { id: string; deletedAt: number | null }[];
  arrangements: { id: string; songId: string; name: string | null }[];
  overlays: { id: string; title: string }[];
}

/** An action of a menu as the core gives it. */
export interface ScenarioAction { id: string; text: string; enabled: boolean; destructive: boolean }

/** What the core answered in a scenario: the items' titles and, in each state, the slide shown and each item's menu. */
export interface ScenarioAnswers {
  items: { id: string; title: string }[];
  states: { state: string; shown: { itemId: string | null; partIndex: number; black: boolean } | null; menus: Record<string, { id: string; actions: ScenarioAction[] }[]> }[];
}

/**
 * A file of scenarios/, as the package exports it, found from the package the test runs in: this file's own URL is no
 * file's in a test with a DOM (happy-dom), where Vitest serves it under /@fs/.
 */
const file = (name: string) => readFileSync(createRequire(`${process.cwd()}/`).resolve(`@gp/core/scenarios/${name}`), 'utf8');

/** The scenario's file. */
export const readScenario = (name: string) => JSON.parse(file(`${name}.json`)) as Scenario;

/** What the core answered, as kept in the scenario's expected file. */
export const scenarioAnswers = (name: string) => JSON.parse(file(`${name}.expected.json`)) as ScenarioAnswers;

/** The scenario's organisation, made by its mutations in a database in memory, and its presentation's page. */
export async function madeScenario(s: Scenario) {
  const db = new DatabaseSync(':memory:');
  const all = (sql: string, params: unknown[] = []) => {
    const st = db.prepare(sql);
    st.setReturnArrays(true);
    return st.all(...(params as never[])) as unknown as Rows;
  };
  const core = new Core();
  core.runSync('migrateOrgSchema', all);
  const mutate = (name: string, args: object) => runMutation({ core, rows: all }, name, args, { userId: 'u', role: 'admin', now: 1000 });
  for (const [name, args] of s.setup) await mutate(name, args);
  const page = (id = s.presentation) => core.view<ScenarioPage>('presentationPageView', { id }, async (sql, params) => all(sql, params));
  return { core, mutate, page };
}
