// tinyjs.json "api" is the list of calls Teneo's pages may make. A call left
// off fails in the app, and one left on is reachable by any script that gets
// into a page, so the list has to match what the pages actually call.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const config = JSON.parse(readFileSync(join(root, "tinyjs.json"), "utf8")) as {
  api?: unknown;
};

// tinyjs reads a plain list as "only these"; client.hello and
// client.capabilities are always allowed
const allowed = Array.isArray(config.api) ? (config.api as string[]) : [];
const isAllowed = (method: string) =>
  ["client.hello", "client.capabilities"].includes(method) ||
  allowed.includes(method);

// Each built-in the pages call, and the call it makes (see tiny.js)
const builtinCalls: Record<string, string> = {
  "tiny.win.show": "win.show",
  "tiny.win.hide": "win.hide",
  "tiny.win.getState": "win.getState",
  "tiny.win.setPosition": "win.setPosition",
  "tiny.tray.position": "tray.position",
  "tiny.clipboard.write": "clip.write",
  "tiny.app.paste": "app.paste",
  "tiny.app.mousePosition": "app.mouse",
  "tiny.app.permissions.check": "perm.check",
  "tiny.app.permissions.request": "perm.request",
  "tiny.app.launchAtLogin.get": "login.get",
  "tiny.app.launchAtLogin.set": "login.set",
  "tiny.quit": "quit",
};
// event listeners and the api namespace itself, which make no call
const notCalls = new Set([
  "tiny.api",
  "tiny.api.call",
  "tiny.api.on",
  "tiny.tray.onClick",
]);
// tiny.js calls these itself for data-tiny-drag regions and window edges
const tinyJsCalls = [
  "win.getState",
  "win.startDrag",
  "win.startResize",
  "win.zoom",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.name === "tiny.d.ts" || entry.name.endsWith(".test.ts"))
      return [];
    return /\.(ts|vue)$/.test(entry.name) ? [path] : [];
  });
}

const pages = sourceFiles(join(root, "src")).map((path) =>
  readFileSync(path, "utf8"),
);
const used = new Set(
  pages.flatMap((code) => code.match(/\btiny(?:\.\w+)+/g) ?? []),
);
const apiCalls = new Set(
  pages.flatMap((code) =>
    [...code.matchAll(/tiny\.api\s*\.call(?:<[^>]*>)?\(\s*"([\w.]+)"/g)].map(
      (match) => match[1],
    ),
  ),
);

const mainSource = readFileSync(join(root, "backend/main.ts"), "utf8");
const apiBlock = mainSource.slice(
  mainSource.indexOf("export const api"),
  mainSource.indexOf("\n};", mainSource.indexOf("export const api")),
);
const backendMethods = new Set(
  [...apiBlock.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]),
);

describe('tinyjs.json "api"', () => {
  test("is a list, so anything not on it is denied", () => {
    expect(Array.isArray(config.api)).toBe(true);
    expect(allowed.some((name) => name.includes("*"))).toBe(false);
  });

  test("allows every built-in the pages call", () => {
    for (const path of used) {
      if (notCalls.has(path)) continue;
      // a page calling a built-in that isn't mapped here has to be added
      // above, and to tinyjs.json if it should be allowed
      expect({ path, method: builtinCalls[path] }).toEqual({
        path,
        method: expect.any(String),
      });
      expect(isAllowed(builtinCalls[path])).toBe(true);
    }
    for (const method of tinyJsCalls) expect(isAllowed(method)).toBe(true);
  });

  test("allows every backend method the pages call", () => {
    for (const method of apiCalls) {
      // a dotted name is one of tinyjs's own, called by its wire name
      if (!method.includes(".")) expect(backendMethods.has(method)).toBe(true);
      expect(isAllowed(method)).toBe(true);
    }
  });

  test("allows nothing the pages don't call", () => {
    const needed = new Set([
      ...tinyJsCalls,
      ...[...used].flatMap((path) => builtinCalls[path] ?? []),
      ...apiCalls,
    ]);
    expect(allowed.filter((method) => !needed.has(method))).toEqual([]);
  });

  test("keeps the pages away from files, keys, scripts and the shell", () => {
    for (const method of [
      "shell.open",
      "shell.reveal",
      "shell.trash",
      "secrets.get",
      "secrets.set",
      "secrets.delete",
      "macos.applescript",
      "app.authenticate",
      "clip.read",
      "store.get",
      "store.set",
      "fetch",
      "debug.get",
      "update.install",
    ]) {
      expect(isAllowed(method)).toBe(false);
    }
  });
});
