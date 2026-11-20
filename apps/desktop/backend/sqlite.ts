import type { Database } from "tjs:sqlite";

export function run(
  database: Database,
  query: string,
  ...values: unknown[]
): void {
  const statement = database.prepare(query);
  try {
    statement.run(...values);
  } finally {
    statement.finalize();
  }
}

export function all<T>(
  database: Database,
  query: string,
  ...values: unknown[]
): T[] {
  const statement = database.prepare(query);
  try {
    return statement.all(...values) as T[];
  } finally {
    statement.finalize();
  }
}

/** Run `work`, synchronous writes only, as one transaction: all of it lands
 *  or none does, crash or error. Call it inside `exclusive`. */
export function transaction<T>(database: Database, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Move what the write-ahead log holds into the database and empty it, so
 *  earlier versions of changed rows (a key before it was encrypted) aren't
 *  left in the -wal file. */
export function checkpoint(database: Database): void {
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

// A sync batch is one transaction that stays open across awaits (a received
// secret is encrypted on the way), and there is one connection: a write made
// meanwhile would join the transaction, and be rolled back with it. So every
// write to the history takes its turn here. Not re-entrant: work that runs
// inside must not call exclusive again.
let tail: Promise<unknown> = Promise.resolve();

export function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => undefined);
  return result;
}
