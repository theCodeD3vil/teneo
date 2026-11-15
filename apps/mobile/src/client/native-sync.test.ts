import { describe, expect, test } from "bun:test";

import { formatRecoveryCode, fromBase64 } from "@teneo/sync";

import { NativeSync } from "./native-sync";
import type { NativeSyncStatus, SyncPlugin } from "./sync-plugin";

const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const notPaired: NativeSyncStatus = {
  paired: false,
  running: false,
  problem: null,
  devices: [],
};
const looking: NativeSyncStatus = { ...notPaired, paired: true, running: true };
const connected: NativeSyncStatus = {
  ...looking,
  devices: [
    {
      id: "mac-1",
      name: "Studio",
      platform: "mac",
      lastSeen: 5,
      connected: true,
    },
  ],
};

/** A plugin that keeps a key like SyncPlugin.java, and can be told to fail */
function fakePlugin(options: { pairFails?: string } = {}) {
  const calls: string[] = [];
  const kept: Uint8Array[] = [];
  const listeners = new Map<string, (event: never) => void>();
  let status = notPaired;
  const plugin: SyncPlugin = {
    getStatus: async () => status,
    pair: async ({ vaultKey }) => {
      calls.push("pair");
      if (options.pairFails) throw new Error(options.pairFails);
      kept.push(fromBase64(vaultKey)!);
      status = looking;
      return status;
    },
    unpair: async () => {
      calls.push("unpair");
      kept.length = 0;
      status = notPaired;
      return status;
    },
    settingsChanged: async () => void calls.push("settingsChanged"),
    requestNotifications: async () => {
      calls.push("requestNotifications");
      return { granted: true };
    },
    addListener: (async (event: string, listener: (event: never) => void) => {
      listeners.set(event, listener);
      return { remove: async () => void listeners.delete(event) };
    }) as SyncPlugin["addListener"],
  };
  const emit = (event: string, data: unknown) =>
    listeners.get(event)?.(data as never);
  return { plugin, calls, kept, emit, listeners };
}

describe("NativeSync", () => {
  test("a wrong code is refused, and native code is never asked", async () => {
    const { plugin, calls, kept } = fakePlugin();
    const sync = new NativeSync(plugin, { waitForDeviceMs: 0 });
    const code = await formatRecoveryCode(key);
    for (const wrong of ["ABCD-1234-EFGH-5678", code.slice(0, -1), "hi"]) {
      const result = await sync.pair(wrong);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("doesn't look right");
    }
    expect([calls, kept]).toEqual([[], []]);
    expect((await sync.getSyncStatus()).state).toBe("not_paired");
  });

  test("a recovery code hands native code the key it holds", async () => {
    const { plugin, kept } = fakePlugin();
    const sync = new NativeSync(plugin, { waitForDeviceMs: 0 });
    const heard: string[] = [];
    sync.onSyncStatusChanged((status) => heard.push(status.state));
    const result = await sync.pair(await formatRecoveryCode(key));
    expect(result).toEqual({ ok: true });
    expect(kept).toEqual([key]);
    expect(heard).toEqual(["searching"]);
  });

  test("names the first device that connects while it waits", async () => {
    const { plugin, emit } = fakePlugin();
    const sync = new NativeSync(plugin, { waitForDeviceMs: 5000 });
    await Promise.resolve();
    const pairing = sync.pair(await formatRecoveryCode(key));
    await Bun.sleep(5);
    emit("statusChanged", connected);
    expect(await pairing).toEqual({ ok: true, deviceName: "Studio" });
  });

  test("what native code refuses is shown, and nothing is said to have changed", async () => {
    const { plugin } = fakePlugin({
      pairFails: "Teneo couldn't keep the sync key safely on this phone.",
    });
    const sync = new NativeSync(plugin, { waitForDeviceMs: 5000 });
    let heard = 0;
    sync.onSyncStatusChanged(() => heard++);
    const started = Date.now();
    const result = await sync.pair(await formatRecoveryCode(key));
    expect(result).toEqual({
      ok: false,
      error: "Teneo couldn't keep the sync key safely on this phone.",
    });
    expect(heard).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("status changes from native code reach the listeners, mapped", async () => {
    const { plugin, emit } = fakePlugin();
    const sync = new NativeSync(plugin);
    await Promise.resolve();
    const heard: unknown[] = [];
    const stop = sync.onSyncStatusChanged((status) => heard.push(status));
    emit("statusChanged", connected);
    stop();
    emit("statusChanged", looking);
    expect(heard).toEqual([
      {
        state: "connected",
        devices: [
          {
            id: "mac-1",
            name: "Studio",
            platform: "Mac",
            lastSeen: 5,
            connected: true,
          },
        ],
      },
    ]);
  });

  test("unpairing tells native code and says it is not paired", async () => {
    const { plugin, calls, kept } = fakePlugin();
    const sync = new NativeSync(plugin, { waitForDeviceMs: 0 });
    await sync.pair(await formatRecoveryCode(key));
    const heard: string[] = [];
    sync.onSyncStatusChanged((status) => heard.push(status.state));
    await sync.unpair();
    expect(calls).toEqual(["pair", "unpair"]);
    expect(kept).toEqual([]);
    expect(heard).toEqual(["not_paired"]);
  });

  test("a code from adb goes to the debug handler; close stops listening", async () => {
    const { plugin, emit, listeners } = fakePlugin();
    const codes: string[] = [];
    const sync = new NativeSync(plugin, {
      onDebugPair: (code) => codes.push(code),
    });
    await Promise.resolve();
    emit("debugPair", { code: "ABCD" });
    expect(codes).toEqual(["ABCD"]);
    await sync.close();
    expect(listeners.size).toBe(0);
  });
});
