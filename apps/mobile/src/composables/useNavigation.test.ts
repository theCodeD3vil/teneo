import { beforeEach, expect, test } from "bun:test";

// --- a browser history small enough to reason about: entries, a position,
// and popstate told a moment after back(), as browsers do

interface Entry {
  state: unknown;
}

function fakeWindow() {
  let entries: Entry[] = [{ state: null }];
  let position = 0;
  const listeners: ((event: { state: unknown }) => void)[] = [];
  const queue: number[] = [];
  let draining = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      await Promise.resolve();
      const delta = queue.shift()!;
      position = Math.max(0, Math.min(entries.length - 1, position + delta));
      for (const listener of listeners) {
        listener({ state: entries[position]!.state });
      }
    }
    draining = false;
  }

  return {
    history: {
      pushState(state: unknown) {
        entries = entries.slice(0, position + 1);
        entries.push({ state: structuredClone(state) });
        position += 1;
      },
      replaceState(state: unknown) {
        entries[position] = { state: structuredClone(state) };
      },
      back() {
        this.go(-1);
      },
      go(delta: number) {
        queue.push(delta);
        void drain();
      },
    },
    addEventListener(_: string, listener: (event: { state: unknown }) => void) {
      listeners.push(listener);
    },
    /** let every back() that was asked for happen */
    async settle() {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    screens: () =>
      entries.map((entry) => (entry.state as { screen: string }).screen),
    position: () => position,
  };
}

let browser: ReturnType<typeof fakeWindow>;
let navigation: typeof import("./useNavigation");

beforeEach(async () => {
  browser = fakeWindow();
  (globalThis as unknown as { window: unknown }).window = browser;
  // a fresh module each time: its state is the app's one history
  navigation = (await import(
    `./useNavigation.ts?fresh=${Math.random()}`
  )) as typeof import("./useNavigation");
});

test("back from a screen returns to the one before", async () => {
  navigation.initNavigation("history");
  const { currentState, openSettings, goBack } = navigation.useNavigation();
  openSettings();
  expect(currentState.value.screen).toBe("settings");
  goBack();
  await browser.settle();
  expect(currentState.value.screen).toBe("history");
});

test("a held back gesture runs its handler and stays on the screen", async () => {
  navigation.initNavigation("setup");
  const { currentState, goBack } = navigation.useNavigation();
  let stepsBack = 0;
  navigation.holdBack(() => (stepsBack += 1));

  goBack(); // the gesture
  await browser.settle();
  expect(stepsBack).toBe(1);
  expect(currentState.value.screen).toBe("setup");
  expect(browser.position()).toBe(0);

  // held once: the next gesture is an ordinary one
  goBack();
  await browser.settle();
  expect(stepsBack).toBe(1);
});

test("letting go of a hold drops its entry without calling the handler", async () => {
  navigation.initNavigation("setup");
  let stepsBack = 0;
  const letGo = navigation.holdBack(() => (stepsBack += 1));
  expect(browser.position()).toBe(1);
  letGo();
  letGo(); // twice is once
  await browser.settle();
  expect(stepsBack).toBe(0);
  expect(browser.position()).toBe(0);
});

test("finishing first-run setup from a later step leaves no way back into it", async () => {
  navigation.initNavigation("setup");
  const { currentState, replaceScreen, openSettings, goBack } =
    navigation.useNavigation();
  const letGo = navigation.holdBack(() => {});

  // what the Done button does
  letGo();
  replaceScreen("history");
  await browser.settle();
  expect(currentState.value.screen).toBe("history");
  expect(browser.screens().slice(0, browser.position() + 1)).toEqual([
    "history",
  ]);

  // and from then on back never shows setup again
  openSettings();
  goBack();
  await browser.settle();
  expect(currentState.value.screen).toBe("history");
});

test("finishing setup opened from Settings goes back to Settings", async () => {
  navigation.initNavigation("history");
  const { currentState, openSettings, openSetup, goBack } =
    navigation.useNavigation();
  openSettings();
  openSetup();
  const letGo = navigation.holdBack(() => {});

  letGo();
  goBack();
  await browser.settle();
  expect(currentState.value.screen).toBe("settings");
});
