/**
 * Reads the npm registry at build time and returns the catalogue.
 *
 * Everything the registry returns is written by package publishers, so it is
 * untrusted. This module is the only place that touches that data: it checks
 * each field's type, caps its length, and keeps only http(s) links. Pages
 * render the result as text and never as HTML.
 *
 * Set CATALOGUE_FIXTURES to a folder to read saved responses instead of the
 * network. The tests use it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REGISTRY = 'https://registry.npmjs.org';
const HEADERS = {
  'User-Agent': 'standardagent-catalogue-build',
  Accept: 'application/json',
};

/** The keyword the specification requires on a packed agent. */
export const AGENT_KEYWORD = 'standardagent';
/** The keyword that providers, clients, and other tooling use. */
export const ECOSYSTEM_KEYWORD = 'standardagents';

const NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PAGE_SIZE = 250;
const MAX_RESULTS = 5000;
const MAX_LIST_ITEMS = 200;
const CONCURRENCY = 8;

export interface ParentHook {
  hook: string;
  reason: string;
  stage?: 'before_parent' | 'after_parent';
}

export interface CataloguePackage {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  license: string;
  /** ISO date of the latest version, when the registry reports one. */
  date: string;
  publisher: string;
  monthlyDownloads: number | null;
  /** The range of @standardagents/spec the package asks for. */
  specRange: string;
  links: { npm: string; homepage?: string; repository?: string };
}

export interface AgentPackage extends CataloguePackage {
  entryAgents: string[];
  effects: string[];
  threadEndpoints: string[];
  parentHooks: { agent: string; hooks: ParentHook[] }[];
}

export interface EcosystemPackage extends CataloguePackage {
  category: 'provider' | 'tooling';
}

export interface Catalogue {
  agents: AgentPackage[];
  ecosystem: EcosystemPackage[];
  /** Packages with the agent keyword but no valid `standardagent` field. */
  skipped: string[];
  fetchedAt: string;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Drop control characters, then collapse whitespace.
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function textList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((item) => text(item, max)).filter(Boolean);
  return [...new Set(items)].slice(0, MAX_LIST_ITEMS);
}

/** Returns the link only when it is a plain http(s) URL. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let candidate = value.trim().replace(/^git\+/, '');
  if (candidate.startsWith('git://')) candidate = `https://${candidate.slice(6)}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username || url.password) return undefined;
  url.pathname = url.pathname.replace(/\.git$/, '');
  return url.href.length > 300 ? undefined : url.href;
}

function repositoryUrl(value: unknown): string | undefined {
  return safeUrl(isRecord(value) ? value.url : value);
}

function parentHooks(value: unknown): AgentPackage['parentHooks'] {
  if (!isRecord(value)) return [];
  const result: AgentPackage['parentHooks'] = [];
  for (const [agent, list] of Object.entries(value).slice(0, MAX_LIST_ITEMS)) {
    if (!Array.isArray(list)) continue;
    const hooks: ParentHook[] = [];
    for (const entry of list.slice(0, MAX_LIST_ITEMS)) {
      if (!isRecord(entry)) continue;
      const hook = text(entry.hook, 100);
      if (!hook) continue;
      const stage =
        entry.stage === 'before_parent' || entry.stage === 'after_parent'
          ? entry.stage
          : undefined;
      hooks.push({ hook, reason: text(entry.reason, 300), stage });
    }
    const name = text(agent, 100);
    if (name && hooks.length) result.push({ agent: name, hooks });
  }
  return result;
}

async function fetchJson(url: string): Promise<unknown | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`npm registry returned ${response.status}`);
      }
      if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Could not read ${url}: ${String(lastError)}`);
}

async function readFixture(file: string): Promise<unknown> {
  const folder = process.env.CATALOGUE_FIXTURES as string;
  return JSON.parse(await readFile(join(folder, file), 'utf8'));
}

/** Every search hit for one exact keyword. */
async function searchKeyword(keyword: string): Promise<Json[]> {
  if (process.env.CATALOGUE_FIXTURES) {
    const saved = await readFixture(`search-${keyword}.json`);
    return isRecord(saved) && Array.isArray(saved.objects) ? saved.objects.filter(isRecord) : [];
  }
  const hits: Json[] = [];
  for (let from = 0; from < MAX_RESULTS; from += PAGE_SIZE) {
    const query = new URLSearchParams({
      text: `keywords:${keyword}`,
      size: String(PAGE_SIZE),
      from: String(from),
    });
    const page = await fetchJson(`${REGISTRY}/-/v1/search?${query}`);
    const objects = isRecord(page) && Array.isArray(page.objects) ? page.objects : [];
    hits.push(...objects.filter(isRecord));
    if (objects.length < PAGE_SIZE) break;
  }
  return hits;
}

/** The package.json of a package's latest version. */
async function latestManifest(name: string): Promise<Json | null> {
  if (process.env.CATALOGUE_FIXTURES) {
    const saved = await readFixture('manifests.json');
    const manifest = isRecord(saved) ? saved[name] : null;
    return isRecord(manifest) ? manifest : null;
  }
  const path = encodeURIComponent(name).replace(/^%40/, '@');
  const manifest = await fetchJson(`${REGISTRY}/${path}/latest`);
  return isRecord(manifest) ? manifest : null;
}

async function mapPool<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

function basePackage(name: string, manifest: Json, hit: Json): CataloguePackage {
  const found = isRecord(hit.package) ? hit.package : {};
  const publisher = isRecord(found.publisher) ? found.publisher : {};
  const downloads = isRecord(hit.downloads) ? hit.downloads.monthly : null;
  const peers = isRecord(manifest.peerDependencies) ? manifest.peerDependencies : {};
  const date = text(found.date, 40);
  return {
    name,
    version: text(manifest.version, 60),
    description: text(manifest.description, 300),
    keywords: textList(manifest.keywords, 40).slice(0, 20),
    license: text(manifest.license, 60),
    date: Number.isNaN(Date.parse(date)) ? '' : new Date(date).toISOString(),
    publisher: text(publisher.username, 60),
    monthlyDownloads:
      typeof downloads === 'number' && Number.isFinite(downloads) && downloads >= 0
        ? Math.round(downloads)
        : null,
    specRange: text(peers['@standardagents/spec'], 60),
    links: {
      npm: `https://www.npmjs.com/package/${name}`,
      homepage: safeUrl(manifest.homepage),
      repository: repositoryUrl(manifest.repository),
    },
  };
}

async function load(): Promise<Catalogue> {
  const [agentHits, ecosystemHits] = await Promise.all([
    searchKeyword(AGENT_KEYWORD),
    searchKeyword(ECOSYSTEM_KEYWORD),
  ]);

  const hits = new Map<string, Json>();
  for (const hit of [...agentHits, ...ecosystemHits]) {
    const name = isRecord(hit.package) ? hit.package.name : undefined;
    if (typeof name === 'string' && name.length <= 214 && NAME_PATTERN.test(name)) {
      if (!hits.has(name)) hits.set(name, hit);
    }
  }

  const agents: AgentPackage[] = [];
  const ecosystem: EcosystemPackage[] = [];
  const skipped: string[] = [];

  await mapPool([...hits], async ([name, hit]) => {
    const manifest = await latestManifest(name);
    // Trust the manifest's own name and keywords, not the search index.
    if (!manifest || manifest.name !== name) return;
    const base = basePackage(name, manifest, hit);
    if (!base.version) return;

    if (base.keywords.includes(AGENT_KEYWORD)) {
      const field = manifest.standardagent;
      const entryAgents = isRecord(field) ? textList(field.entryAgents, 100) : [];
      if (!isRecord(field) || entryAgents.length === 0) {
        skipped.push(name);
        return;
      }
      agents.push({
        ...base,
        entryAgents,
        effects: textList(field.effects, 100),
        threadEndpoints: textList(field.threadEndpoints, 200),
        parentHooks: parentHooks(field.parentHooks),
      });
    } else if (base.keywords.includes(ECOSYSTEM_KEYWORD)) {
      ecosystem.push({
        ...base,
        category: base.keywords.includes('provider') ? 'provider' : 'tooling',
      });
    }
  });

  const byName = (a: CataloguePackage, b: CataloguePackage) => a.name.localeCompare(b.name);
  agents.sort((a, b) => (b.monthlyDownloads ?? 0) - (a.monthlyDownloads ?? 0) || byName(a, b));
  ecosystem.sort(byName);
  skipped.sort();

  if (skipped.length) {
    console.warn(
      `[catalogue] Skipped ${skipped.length} package(s) with the "${AGENT_KEYWORD}" keyword ` +
        `but no valid "standardagent" field: ${skipped.join(', ')}`,
    );
  }

  return { agents, ecosystem, skipped, fetchedAt: new Date().toISOString() };
}

let cached: Promise<Catalogue> | undefined;

/** The catalogue, read once per build. A registry failure fails the build. */
export function getCatalogue(): Promise<Catalogue> {
  cached ??= load();
  return cached;
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(
    count,
  );
}
