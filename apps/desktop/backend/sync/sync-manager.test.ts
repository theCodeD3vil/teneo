import { expect, test } from "bun:test";

import {
  type SyncStatus,
  syncStatusChangedEvent,
} from "@teneo/shared/types/sync";
import {
  type ConnectedPeer,
  type PeerRecord,
  formatRecoveryCode,
  fromBase64,
  parseRecoveryCode,
  randomBytes,
  toBase64,
} from "@teneo/sync";

import { getSettings, loadSettings, updateSettings } from "../settings";
import type { SyncService, SyncServiceOptions } from "./service";
import { SyncManager, type SyncManagerDeps } from "./sync-manager";

const keyName = "sync-vault-key";

interface Options {
  available?: boolean;
  startFails?: boolean;
  /** what the Keychain does when a key is saved */
  keychainSaves?: boolean;
  keychainReadThrows?: boolean;
  port?: number | null;
  /** how many items hold secrets */
  held?: number;
}

async function setup(options: Options = {}) {
  const store = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const pushed: Array<{ event: string; data: SyncStatus }> = [];
  const app = {
    store: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => store.set(key, value) && true,
    },
    secrets: {
      get: async (key: string) => {
        if (options.keychainReadThrows) throw new Error("denied");
        return secrets.get(key) ?? null;
      },
      set: async (key: string, value: string) => {
        if (options.keychainSaves === false) return false;
        secrets.set(key, value);
        return true;
      },
      delete: async (key: string) => secrets.delete(key),
    },
    push: (event: string, data: SyncStatus) => pushed.push({ event, data }),
  } as unknown as TinyApp;
  await loadSettings(app); // starts from the defaults: the settings are module state

  const connected: ConnectedPeer[] = [];
  const known: PeerRecord[] = [];
  const calls = {
    started: [] as SyncServiceOptions[],
    stopped: 0,
    stoppedAnnouncing: 0,
    changed: 0,
    restamped: 0,
    forgotten: 0,
  };
  const logged: string[] = [];
  const service = {
    deviceId: "me",
    port: options.port === undefined ? 47823 : options.port,
    peers: () => connected,
    knownPeers: async () => known,
    localChanged: () => {
      calls.changed += 1;
    },
    stop: async () => {
      calls.stopped += 1;
    },
    stopAnnouncing: () => {
      calls.stoppedAnnouncing += 1;
    },
  } as SyncService;
  const deps: SyncManagerDeps = {
    available: () => options.available ?? true,
    start: async (_app, startOptions) => {
      // yield, as the real one does, so overlapping calls really overlap
      await Promise.resolve();
      if (options.startFails) throw new Error("the port code failed");
      calls.started.push(startOptions);
      return service;
    },
    restampSecretItems: async () => {
      calls.restamped += 1;
      return options.held ?? 3;
    },
    forgetPeers: async () => {
      calls.forgotten += 1;
    },
    computerName: async () => "Test Mac",
    networkAddresses: () => [
      { name: "en0", address: "192.168.1.20", internal: false },
    ],
    log: (message) => {
      logged.push(message);
    },
  };
  const manager = new SyncManager(app, deps);
  return { manager, app, secrets, pushed, calls, logged, connected, known };
}

const savedKey = (secrets: Map<string, string>) =>
  fromBase64(secrets.get(keyName) ?? "");

test("with sync off, nothing runs and the status says so", async () => {
  const { manager, calls } = await setup();
  const status = await manager.status();
  expect(status).toMatchObject({
    available: true,
    enabled: false,
    running: false,
    problem: null,
    deviceName: "Test Mac",
    devices: [],
  });
  expect(calls.started).toHaveLength(0);
});

test("without the feature switched on, nothing starts and changes are refused", async () => {
  const { manager, app, calls, secrets } = await setup({ available: false });
  // even with the setting saved from an earlier run with the feature on, and
  // a key in the Keychain: only the switch stands in the way
  await updateSettings({ syncEnabled: true }, app);
  const seeded = toBase64(randomBytes(32));
  secrets.set(keyName, seeded);
  await manager.startIfEnabled();
  expect(calls.started).toHaveLength(0);
  expect((await manager.status()).available).toBe(false);
  expect((await manager.status()).enabled).toBe(false);
  await expect(manager.turnOn()).rejects.toThrow("isn't available");
  await expect(manager.join("x")).rejects.toThrow("isn't available");
  await expect(manager.turnOff()).rejects.toThrow("isn't available");
  await expect(manager.setSyncSecrets(true)).rejects.toThrow("isn't available");
  await expect(manager.pairingInfo()).rejects.toThrow("isn't available");
  expect(secrets.get(keyName)).toBe(seeded); // left as it was
});

test("turning sync on makes a vault key, keeps it in the Keychain and starts", async () => {
  const { manager, calls, secrets, pushed } = await setup();
  const status = await manager.turnOn();

  const key = savedKey(secrets);
  expect(key?.length).toBe(32);
  expect(getSettings().syncEnabled).toBe(true);
  expect(calls.started).toHaveLength(1);
  expect(calls.started[0]!.vaultKey).toEqual(key!);
  expect(calls.started[0]!.name).toBe("Test Mac");
  expect(status).toMatchObject({ enabled: true, running: true, problem: null });
  expect(pushed.at(-1)?.event).toBe(syncStatusChangedEvent);
  expect(pushed.at(-1)?.data.running).toBe(true);
  // nothing the page is sent holds the key
  expect(JSON.stringify(pushed)).not.toContain(secrets.get(keyName)!);
});

test("a double click starts one engine, and a second turn on changes nothing", async () => {
  const { manager, calls, secrets } = await setup();
  await Promise.all([manager.turnOn(), manager.turnOn()]);
  const key = secrets.get(keyName);
  await manager.turnOn();
  expect(calls.started).toHaveLength(1);
  expect(secrets.get(keyName)).toBe(key);
});

test("when the engine can't start, sync is left off and the key is not kept", async () => {
  const { manager, secrets, logged } = await setup({ startFails: true });
  await expect(manager.turnOn()).rejects.toThrow("Sync couldn't start.");
  expect(getSettings().syncEnabled).toBe(false);
  expect(secrets.has(keyName)).toBe(false);
  expect((await manager.status()).running).toBe(false);
  expect(logged).toContain("starting sync failed:");
});

test("when the Keychain won't keep the key, sync is not turned on", async () => {
  const { manager, calls } = await setup({ keychainSaves: false });
  await expect(manager.turnOn()).rejects.toThrow("Keychain");
  expect(getSettings().syncEnabled).toBe(false);
  expect(calls.started).toHaveLength(0);
});

test("joining takes the vault of the recovery code", async () => {
  const { manager, calls, secrets } = await setup();
  const key = randomBytes(32);
  const status = await manager.join(await formatRecoveryCode(key));
  expect(savedKey(secrets)).toEqual(key);
  expect(calls.started[0]!.vaultKey).toEqual(key);
  expect(status.enabled).toBe(true);
});

test("a mistyped recovery code is refused and nothing changes", async () => {
  const { manager, calls, secrets } = await setup();
  const code = await formatRecoveryCode(randomBytes(32));
  const mistyped = (code[0] === "0" ? "1" : "0") + code.slice(1);
  await expect(manager.join(mistyped)).rejects.toThrow("join code");
  await expect(manager.join("")).rejects.toThrow("join code");
  expect(secrets.size).toBe(0);
  expect(calls.started).toHaveLength(0);
  expect(getSettings().syncEnabled).toBe(false);
});

test("a device that has sync on must turn it off before joining another vault", async () => {
  const { manager, secrets } = await setup();
  await manager.turnOn();
  const before = secrets.get(keyName);
  await expect(
    manager.join(await formatRecoveryCode(randomBytes(32))),
  ).rejects.toThrow("Turn sync off");
  expect(secrets.get(keyName)).toBe(before);
});

test("turning sync off stops it, forgets the key and the devices, and says so", async () => {
  const { manager, calls, secrets, pushed } = await setup();
  await manager.turnOn();
  const status = await manager.turnOff();
  expect(calls.stopped).toBe(1);
  expect(calls.forgotten).toBe(1);
  expect(secrets.has(keyName)).toBe(false);
  expect(getSettings().syncEnabled).toBe(false);
  expect(status).toMatchObject({ enabled: false, running: false, devices: [] });
  expect(pushed.at(-1)?.data.enabled).toBe(false);
});

test("at launch, sync that was on starts again with the key from the Keychain", async () => {
  const first = await setup();
  await first.manager.turnOn();
  const key = savedKey(first.secrets)!;

  // a new launch: same settings and Keychain, no engine
  const second = await setup();
  second.secrets.set(keyName, first.secrets.get(keyName)!);
  await updateSettings({ syncEnabled: true }, second.app);
  await second.manager.startIfEnabled();
  expect(second.calls.started).toHaveLength(1);
  expect(second.calls.started[0]!.vaultKey).toEqual(key);
  expect((await second.manager.status()).running).toBe(true);
});

test("at launch with sync off, nothing starts and the Keychain is not read", async () => {
  const { manager, calls } = await setup({ keychainReadThrows: true });
  await manager.startIfEnabled();
  expect(calls.started).toHaveLength(0);
  expect((await manager.status()).problem).toBeNull();
});

test("at launch, a missing or unreadable key is explained, not hidden", async () => {
  const missing = await setup();
  await updateSettings({ syncEnabled: true }, missing.app);
  await missing.manager.startIfEnabled();
  expect(missing.calls.started).toHaveLength(0);
  expect((await missing.manager.status()).problem).toContain("sync key");

  const denied = await setup({ keychainReadThrows: true });
  await updateSettings({ syncEnabled: true }, denied.app);
  await denied.manager.startIfEnabled();
  expect(denied.calls.started).toHaveLength(0);
  expect((await denied.manager.status()).problem).toContain("Keychain");
});

test("turning on 'items with secrets' sends the held-back ones, once", async () => {
  const { manager, calls } = await setup();
  await manager.turnOn();
  await manager.setSyncSecrets(true);
  expect(getSettings().syncSecrets).toBe(true);
  expect(calls.restamped).toBe(1);
  expect(calls.changed).toBe(1);
  await manager.setSyncSecrets(true); // already on: nothing to send again
  expect(calls.restamped).toBe(1);
  await manager.setSyncSecrets(false); // can't be taken back from a device
  expect(getSettings().syncSecrets).toBe(false);
  expect(calls.restamped).toBe(1);
});

test("no held-back items means nothing to announce", async () => {
  const { manager, calls } = await setup({ held: 0 });
  await manager.turnOn();
  await manager.setSyncSecrets(true);
  expect(calls.restamped).toBe(1);
  expect(calls.changed).toBe(0);
});

test("with sync off, the secrets setting is only remembered", async () => {
  const { manager, calls } = await setup();
  await manager.setSyncSecrets(true);
  expect(getSettings().syncSecrets).toBe(true);
  expect(calls.restamped).toBe(0);
});

test("pairing info carries the vault key as a recovery code and a link", async () => {
  const { manager, secrets } = await setup();
  await manager.turnOn();
  const info = await manager.pairingInfo();
  expect(await parseRecoveryCode(info.recoveryCode)).toEqual(
    savedKey(secrets)!,
  );
  expect(info.link).toStartWith("teneo://pair?v=1&k=");
  expect(info.link).toContain("a=192.168.1.20:47823");
});

test("pairing info needs sync on", async () => {
  const { manager } = await setup();
  await expect(manager.pairingInfo()).rejects.toThrow("Turn sync on first");
});

test("with no port to listen on, sync runs and says what it can't do", async () => {
  const { manager } = await setup({ port: null });
  const status = await manager.turnOn();
  expect(status.running).toBe(true);
  expect(status.problem).toContain("port");
  expect((await manager.pairingInfo()).link).not.toContain("192.168");
});

test("devices are the connected ones first, then the others by name", async () => {
  const { manager, connected, known } = await setup();
  await manager.turnOn();
  known.push(
    record("b", "Zed", 100),
    record("a", "Anna's phone", 200),
    record("c", "Mac mini", 300),
  );
  connected.push(
    peer("c", "Mac mini"),
    peer("n", "New one"), // connected, not paired before
  );
  const { devices } = await manager.status();
  expect(devices.map((d) => [d.name, d.connected])).toEqual([
    ["Mac mini", true],
    ["New one", true],
    ["Anna's phone", false],
    ["Zed", false],
  ]);
});

test("a quit ends what announces this Mac without waiting", async () => {
  const { manager, calls } = await setup();
  manager.stopAnnouncing(); // sync is off: nothing to end
  expect(calls.stoppedAnnouncing).toBe(0);
  await manager.turnOn();
  manager.stopAnnouncing();
  expect(calls.stoppedAnnouncing).toBe(1);
  expect(getSettings().syncEnabled).toBe(true);
});

test("stopping at quit ends the engine and leaves sync on", async () => {
  const { manager, calls } = await setup();
  await manager.turnOn();
  await manager.stop();
  expect(calls.stopped).toBe(1);
  expect(getSettings().syncEnabled).toBe(true);
  expect((await manager.status()).running).toBe(false);
});

test("a hold shows the reason to the windows, when sync is on", async () => {
  const { manager, pushed } = await setup();
  await manager.hold("ignored: sync is off");
  expect(pushed).toHaveLength(0);

  await manager.turnOn();
  await manager.hold("Teneo couldn't check your history.");
  expect(pushed.at(-1)?.data.problem).toBe(
    "Teneo couldn't check your history.",
  );
});

function record(
  deviceId: string,
  name: string,
  lastSeenAt: number,
): PeerRecord {
  return {
    deviceId,
    name,
    platform: "mac",
    epoch: null,
    receivedSeq: 0,
    lastAddress: null,
    lastSeenAt,
  };
}

function peer(deviceId: string, name: string): ConnectedPeer {
  return { deviceId, name, platform: "mac", address: undefined };
}
