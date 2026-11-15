import { describe, expect, test } from "bun:test";

import type { Update } from "./releases";
import type { InstallStatus, UpdatePlugin } from "./update-plugin";
import { type UpdateState, Updater } from "./updater";

const update: Update = {
  version: "0.2.0",
  versionCode: 20_099,
  apkUrl:
    "https://github.com/theCodeD3vil/teneo/releases/download/android-v0.2.0/Teneo-0.2.0.apk",
  size: 9_000_000,
  sha256: "ab".repeat(32),
};
const day = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

/** UpdatePlugin.java, as far as the updater sees it */
function fakePlugin(
  options: { allowed?: boolean; installFails?: unknown } = {},
) {
  const calls: string[] = [];
  const listeners = new Map<string, (event: never) => void>();
  let release: (() => void) | null = null;
  let fail: ((error: unknown) => void) | null = null;
  const plugin = {
    canInstall: async () => ({ allowed: options.allowed ?? true }),
    openInstallSettings: async () => void calls.push("openInstallSettings"),
    install: (request: { url: string }) => {
      calls.push(`install ${request.url}`);
      if (options.installFails) return Promise.reject(options.installFails);
      return new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
    },
    cancel: async () => {
      calls.push("cancel");
      const error = Object.assign(new Error("Cancelled"), {
        code: "cancelled",
      });
      fail?.(error);
    },
    requestNotifications: async () => {
      calls.push("requestNotifications");
      return { granted: true };
    },
    addListener: async (event: string, listener: (event: never) => void) => {
      listeners.set(event, listener);
      return { remove: async () => undefined };
    },
  } as unknown as UpdatePlugin;
  return {
    plugin,
    calls,
    progress: (received: number) =>
      listeners.get("progress")?.({ received, total: update.size } as never),
    status: (status: InstallStatus) =>
      listeners.get("installStatus")?.(status as never),
    handedOver: () => release?.(),
    openedFromNotification: () =>
      (listeners.get("openedFromNotification") as (() => void) | undefined)?.(),
  };
}

function updater(
  options: {
    plugin?: UpdatePlugin | null;
    find?: () => Promise<Update | null>;
    now?: () => number;
    storage?: ReturnType<typeof memoryStorage>;
  } = {},
) {
  const states: UpdateState["kind"][] = [];
  const instance = new Updater({
    current: async () => "0.1.0",
    plugin: options.plugin ?? null,
    find: options.find ?? (async () => update),
    storage: options.storage ?? memoryStorage(),
    now: options.now ?? (() => 10 * day),
  });
  instance.onChange((state) => states.push(state.kind));
  return { instance, states };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Updater", () => {
  test("checks and says what it found", async () => {
    const found = updater();
    expect(await found.instance.check()).toEqual(update);
    expect(found.instance.state).toEqual({ kind: "available", update });
    expect(found.states).toEqual(["checking", "available"]);

    const none = updater({ find: async () => null });
    expect(await none.instance.check()).toBeNull();
    expect(none.instance.state.kind).toBe("up_to_date");
  });

  test("shares a check already under way", async () => {
    let finds = 0;
    const { instance } = updater({
      find: async () => {
        finds += 1;
        return update;
      },
    });
    const answers = await Promise.all([instance.check(), instance.check()]);
    expect(finds).toBe(1);
    // the second caller gets what the check finds, not "nothing yet"
    expect(answers).toEqual([update, update]);
  });

  test("an update with Android's installer isn't downloaded a second time", async () => {
    const fake = fakePlugin();
    const { instance } = updater({ plugin: fake.plugin });
    await instance.check();
    const installing = instance.install();
    await flush();
    fake.handedOver();
    await installing;
    expect(instance.state.kind).toBe("installing");

    await instance.install(); // "Update" tapped again in About
    expect(fake.calls).toEqual([`install ${update.apkUrl}`]);
    // once Android says the install was called off, it can be started again
    fake.status({ status: "cancelled" });
    void instance.install();
    await flush();
    expect(fake.calls).toHaveLength(2);
  });

  test("reports a failed check", async () => {
    const { instance } = updater({
      find: async () => {
        throw new Error("boom");
      },
    });
    expect(await instance.check()).toBeNull();
    expect(instance.state).toEqual({
      kind: "failed",
      update: null,
      message: "Couldn't check for updates",
    });
  });

  test("looks once a day when the app opens", async () => {
    let now = 10 * day;
    let finds = 0;
    const { instance } = updater({
      now: () => now,
      find: async () => {
        finds += 1;
        return update;
      },
    });
    expect(await instance.checkIfDue()).toEqual(update);
    now += day - 1;
    expect(await instance.checkIfDue()).toBeNull();
    expect(finds).toBe(1);
    now += 1;
    expect(await instance.checkIfDue()).toEqual(update);
    // a clock set back doesn't put the next look off
    now -= 5 * day;
    expect(await instance.checkIfDue()).toEqual(update);
    expect(finds).toBe(3);
  });

  test("doesn't offer a version the user put off again", async () => {
    let now = 10 * day;
    const storage = memoryStorage();
    const { instance } = updater({ now: () => now, storage });
    expect(await instance.checkIfDue()).toEqual(update);
    instance.dismiss(update);
    now += day;
    expect(await instance.checkIfDue()).toBeNull();
    // About still shows it
    expect(instance.state).toEqual({ kind: "available", update });
    const newer = { ...update, version: "0.3.0", versionCode: 30_099 };
    const next = updater({
      now: () => now + day,
      storage,
      find: async () => newer,
    });
    expect(await next.instance.checkIfDue()).toEqual(newer);
  });

  test("downloads and hands the update to Android's installer", async () => {
    const fake = fakePlugin();
    const { instance, states } = updater({ plugin: fake.plugin });
    await instance.check();
    const installing = instance.install();
    await flush();
    expect(fake.calls).toEqual([`install ${update.apkUrl}`]);
    fake.progress(4_500_000);
    expect(instance.state).toEqual({
      kind: "downloading",
      update,
      received: 4_500_000,
    });
    fake.handedOver();
    await installing;
    expect(instance.state.kind).toBe("installing");
    fake.status({ status: "cancelled" });
    expect(instance.state).toEqual({ kind: "available", update });
    expect(states).toEqual([
      "checking",
      "available",
      "downloading",
      "downloading",
      "installing",
      "available",
    ]);
  });

  test("asks for the install permission first", async () => {
    const fake = fakePlugin({ allowed: false });
    const { instance } = updater({ plugin: fake.plugin });
    await instance.check();
    await instance.install();
    expect(fake.calls).toEqual(["openInstallSettings"]);
    expect(instance.state).toEqual({ kind: "needs_permission", update });
  });

  test("goes back to the update when the download is cancelled", async () => {
    const fake = fakePlugin();
    const { instance } = updater({ plugin: fake.plugin });
    await instance.check();
    const installing = instance.install();
    await flush();
    await instance.cancel();
    await installing;
    expect(fake.calls).toContain("cancel");
    expect(instance.state).toEqual({ kind: "available", update });
  });

  test("keeps the update to try again when installing fails", async () => {
    const fake = fakePlugin({
      installFails: new Error("The download doesn't match the release"),
    });
    const { instance } = updater({ plugin: fake.plugin });
    await instance.check();
    await instance.install();
    expect(instance.state).toEqual({
      kind: "failed",
      update,
      message: "The download doesn't match the release",
    });
  });

  test("reports what Android's installer said", async () => {
    const fake = fakePlugin();
    const { instance } = updater({ plugin: fake.plugin });
    await instance.check();
    void instance.install();
    await flush();
    fake.status({ status: "failed", message: "Android blocked the update" });
    expect(instance.state).toEqual({
      kind: "failed",
      update,
      message: "Android blocked the update",
    });
  });

  test("asks to show notifications only once", async () => {
    const fake = fakePlugin();
    const storage = memoryStorage();
    const first = updater({ plugin: fake.plugin, storage });
    await first.instance.askToNotify();
    await first.instance.askToNotify();
    await updater({ plugin: fake.plugin, storage }).instance.askToNotify();
    expect(fake.calls).toEqual(["requestNotifications"]);
  });

  test("tells of an open from the notification, even one before anything listened", async () => {
    const fake = fakePlugin();
    const { instance } = updater({ plugin: fake.plugin });
    await flush();
    fake.openedFromNotification();
    let opens = 0;
    const stop = instance.onOpenedFromNotification(() => opens++);
    expect(opens).toBe(1);
    fake.openedFromNotification();
    expect(opens).toBe(2);
    stop();
    instance.onOpenedFromNotification(() => opens++);
    expect(opens).toBe(2);
  });

  test("says an update can't be installed without the native plugin", async () => {
    const { instance } = updater({ plugin: null });
    await instance.install();
    expect(instance.state).toEqual({ kind: "idle" });
    await instance.check();
    await instance.install();
    expect(instance.state).toEqual({
      kind: "failed",
      update,
      message: "Updates install in the Android app",
    });
  });
});
