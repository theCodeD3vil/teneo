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
