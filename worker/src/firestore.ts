import { getAccessToken } from './google';
import type { Env } from './types';

export type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
};

export interface FsDoc {
  name: string;
  fields?: Record<string, FsValue>;
}

export class Firestore {
  private readonly root: string;
  private readonly base: string;

  constructor(private readonly env: Env) {
    this.root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  docName(path: string): string {
    return `${this.root}/${path}`;
  }

  private async call<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(url, {
      method: init.method ?? 'POST',
      headers: { authorization: `Bearer ${await getAccessToken(this.env)}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new Error(`Firestore ${url.split('?')[0]} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  /** A collection-group query with one filter. Returns every matching doc. */
  async queryGroup(collectionId: string, field: string, op: 'EQUAL' | 'GREATER_THAN_OR_EQUAL', value: FsValue): Promise<FsDoc[]> {
    const rows = await this.call<{ document?: FsDoc }[]>(`${this.base}:runQuery`, {
      body: {
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
          where: { fieldFilter: { field: { fieldPath: field }, op, value } },
        },
      },
    });
    return rows.flatMap((r) => (r.document ? [r.document] : []));
  }

  /** Fetches docs by full name; missing docs come back as null in the same order. */
  async getAll(names: string[]): Promise<(FsDoc | null)[]> {
    const out = new Map<string, FsDoc>();
    for (let i = 0; i < names.length; i += 100) {
      const rows = await this.call<{ found?: FsDoc }[]>(`${this.base}:batchGet`, {
        body: { documents: names.slice(i, i + 100) },
      });
      for (const r of rows) if (r.found) out.set(r.found.name, r.found);
    }
    return names.map((n) => out.get(n) ?? null);
  }

  /** Writes whole docs (replacing them). */
  async set(docs: FsDoc[]): Promise<void> {
    for (let i = 0; i < docs.length; i += 400) {
      await this.call(`${this.base}:commit`, { body: { writes: docs.slice(i, i + 400).map((update) => ({ update })) } });
    }
  }

  /** Deletes docs by full name, in batches under Firestore's 500-write limit. */
  async deleteDocs(names: string[]): Promise<void> {
    for (let i = 0; i < names.length; i += 400) {
      await this.call(`${this.base}:commit`, { body: { writes: names.slice(i, i + 400).map((d) => ({ delete: d })) } });
    }
  }

  /** Deletes a doc and everything under it, like the Admin SDK's recursiveDelete. `path` is relative, e.g. `users/{uid}`. */
  async deleteTree(path: string): Promise<void> {
    const names: string[] = [];
    await this.collect(path, names);
    await this.deleteDocs(names);
  }

  private async collect(docPath: string, out: string[]): Promise<void> {
    const { collectionIds = [] } = await this.call<{ collectionIds?: string[] }>(`${this.base}/${docPath}:listCollectionIds`, {
      body: {},
    });
    for (const id of collectionIds) {
      let pageToken: string | undefined;
      do {
        const url = new URL(`${this.base}/${docPath}/${id}`);
        url.searchParams.set('pageSize', '300');
        url.searchParams.set('showMissing', 'true');
        url.searchParams.append('mask.fieldPaths', '__name__');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const page = await this.call<{ documents?: FsDoc[]; nextPageToken?: string }>(url.toString(), { method: 'GET' });
        for (const d of page.documents ?? []) {
          await this.collect(d.name.slice(this.root.length + 1), out);
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    out.push(this.docName(docPath));
  }
}
