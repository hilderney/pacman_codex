import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export const LOCAL_SQLITE_IDB_NAME = 'neon-maze-local';
const DB_KEY = 'neon-maze-local-sqlite';
const IDB_NAME = LOCAL_SQLITE_IDB_NAME;
const IDB_STORE = 'sqlite';

type Bind = SqlValue[];

const SCHEMA = `
create table if not exists profiles (
  user_id text primary key,
  nickname text not null unique collate nocase
    check (length(nickname) between 3 and 12)
);
create table if not exists scores (
  user_id text primary key references profiles(user_id) on delete cascade,
  best_score integer not null check (best_score between 0 and 9007199254740991),
  level_reached integer not null check (level_reached between 1 and 9007199254740991),
  updated_at text not null
);
create table if not exists score_submissions (
  user_id text not null,
  run_id text not null,
  submitted_at text not null,
  primary key (user_id, run_id)
);
create table if not exists achievement_definitions (
  slug text primary key,
  family_key text not null,
  tier integer not null default 1,
  badge_key text not null,
  exclusive integer not null default 0,
  active integer not null default 1,
  sort_order integer not null unique
);
create table if not exists player_achievements (
  user_id text not null references profiles(user_id) on delete cascade,
  slug text not null references achievement_definitions(slug),
  awarded_at text not null,
  primary key (user_id, slug)
);
create table if not exists exclusive_holders (
  slug text primary key references achievement_definitions(slug),
  user_id text not null references profiles(user_id) on delete cascade,
  awarded_at text not null
);
create table if not exists achievement_candidates (
  candidate_id integer primary key autoincrement,
  slug text not null references achievement_definitions(slug),
  user_id text not null references profiles(user_id) on delete cascade,
  qualified_at text not null,
  unique (slug, user_id)
);
create table if not exists achievement_runs (
  user_id text not null references profiles(user_id) on delete cascade,
  run_id text not null,
  last_sequence integer not null default 0,
  elapsed_ms integer not null default 0,
  cleared integer not null default 0,
  deaths integer not null default 0,
  screen_deaths integer not null default 0,
  peak integer not null default 0,
  tunnel_count integer not null default 0,
  power_id integer not null default 0,
  power_started_ms integer not null default 0,
  captures integer not null default 0,
  ended integer not null default 0,
  primary key (user_id, run_id)
);
create table if not exists achievement_events (
  user_id text not null,
  run_id text not null,
  sequence integer not null,
  kind text not null,
  payload text not null,
  received_at text not null,
  primary key (user_id, run_id, sequence),
  foreign key (user_id, run_id) references achievement_runs(user_id, run_id) on delete cascade
);
create table if not exists noob_runs (
  user_id text not null references profiles(user_id) on delete cascade,
  run_id text not null,
  primary key (user_id, run_id)
);
create table if not exists leaderboard_daily_leaders (
  day_utc text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  score integer not null,
  captured_at text not null
);
`;

const DEFINITIONS: [string, string, number, string, number, number][] = [
  ['ace_spirit', 'survival', 1, 'halo', 0, 1],
  ['noob', 'survival', 1, 'spark_broken', 0, 2],
  ['neon_maze_king', 'ranking', 1, 'crown', 0, 3],
  ['first_light', 'firsts', 1, 'prism', 1, 4],
  ['light_bringer', 'firsts', 2, 'beacon', 1, 5],
  ['neon_pioneer', 'firsts', 1, 'flag', 1, 6],
  ['spark_starter', 'spark', 1, 'spark', 0, 7],
  ['spark_keeper', 'spark', 2, 'spark', 0, 8],
  ['still_standing', 'survival', 2, 'shield', 0, 9],
  ['tunnel_loop', 'exploration', 1, 'portal', 0, 10],
  ['amazind_circuit', 'circuit', 1, 'circuit', 0, 11],
  ['perfect_circuit', 'circuit', 2, 'circuit', 0, 12],
  ['ominius_circuit', 'circuit', 3, 'circuit', 0, 13],
  ['phantom_quartet', 'phantom', 4, 'phantom', 0, 14],
  ['phantom_quintuplets', 'phantom', 5, 'phantom', 0, 15],
  ['phantom_sextuplets', 'phantom', 6, 'phantom', 0, 16],
  ['phantom_septuplets', 'phantom', 7, 'phantom', 0, 17],
  ['phantom_octuplets', 'phantom', 8, 'phantom', 0, 18],
];

let SQL: SqlJsStatic | null = null;

async function loadSql(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  // Vitest/Node cannot fetch the Vite `?url` asset; embed the wasm bytes instead.
  if (typeof window === 'undefined' || import.meta.env.MODE === 'test') {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const wasmBinary = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
    SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
  } else {
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  }
  return SQL;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(DB_KEY);
      req.onsuccess = () => {
        const value = req.result;
        resolve(value instanceof Uint8Array ? value : value ? new Uint8Array(value) : null);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  } catch {
    return null;
  }
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } catch {
    /* Persistence is best-effort in local mode. */
  }
}

export class SqliteStore {
  private db: Database | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  async open() {
    if (this.db) return this.db;
    const SQL = await loadSql();
    const bytes = await loadBytes();
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.run(SCHEMA);
    const count = this.scalar<number>('select count(*) from achievement_definitions') ?? 0;
    if (count === 0) {
      const insert = this.db.prepare(
        'insert into achievement_definitions(slug,family_key,tier,badge_key,exclusive,active,sort_order) values(?,?,?,?,?,1,?)',
      );
      for (const row of DEFINITIONS) {
        insert.run(row);
      }
      insert.free();
      this.schedulePersist();
    }
    return this.db;
  }

  get database(): Database {
    if (!this.db) throw new Error('SQLite store is not open');
    return this.db;
  }

  scalar<T extends SqlValue>(sql: string, params: Bind = []): T | null {
    const stmt = this.database.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      const row = stmt.get();
      return (row[0] as T) ?? null;
    } finally {
      stmt.free();
    }
  }

  one<T extends object>(sql: string, params: Bind = []): T | null {
    const stmt = this.database.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      return stmt.getAsObject() as T;
    } finally {
      stmt.free();
    }
  }

  all<T extends object>(sql: string, params: Bind = []): T[] {
    const stmt = this.database.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(sql: string, params: Bind = []) {
    this.database.run(sql, params);
    this.schedulePersist();
  }

  transaction(work: () => void) {
    this.database.run('begin immediate');
    try {
      work();
      this.database.run('commit');
      this.schedulePersist();
    } catch (error) {
      try { this.database.run('rollback'); } catch { /* ignore */ }
      throw error;
    }
  }

  schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 50);
  }

  async persist() {
    if (!this.db) return;
    await saveBytes(this.db.export());
  }
}
