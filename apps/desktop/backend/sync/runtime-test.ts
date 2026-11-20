// A tiny test runner for the tests that run on the real runtime, where bun's
// is not available. Call `finish()` last: it ends the run with the exit code.
/* oxlint-disable no-console -- a test run reports on the console */

let failed = 0;

export async function test(
  name: string,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    // txiki's stack has no message in it
    console.log(
      `     ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`,
    );
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function same(actual: unknown, expected: unknown, what: string): void {
  const [a, b] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

export async function rejects(
  work: Promise<unknown>,
  what: string,
): Promise<void> {
  try {
    await work;
  } catch {
    return;
  }
  throw new Error(`${what}: it did not fail`);
}

export function finish(): void {
  if (failed > 0) {
    console.log(`\n${failed} failed`);
    tjs.exit(1);
  }
  console.log("\nall passed");
  // nothing left waiting on a timer (the decrypted-text cache) holds it open
  tjs.exit(0);
}
