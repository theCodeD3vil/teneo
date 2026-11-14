import { expect, test } from "bun:test";

import { syncOpenPanelShortcut } from "./global-shortcut";
import { updateSettings } from "./settings";

test("a shortcut that failed to register is tried again, one that worked is not", async () => {
  // oxlint-disable-next-line no-console -- the refused shortcut is logged on purpose
  console.error = () => {};
  const results = [false, true];
  let registerCalls = 0;
  const app = {
    store: { get: async () => undefined, set: async () => true },
    push: () => {},
    hotkey: {
      register: async () => results[registerCalls++],
      unregister: () => {},
    },
  } as unknown as TinyApp;

  await updateSettings({ openPanelShortcut: "ctrl+opt+v" }, app);
  await syncOpenPanelShortcut(app); // refused: another app holds it
  await syncOpenPanelShortcut(app); // retried, accepted
  await syncOpenPanelShortcut(app); // nothing left to do
  expect(registerCalls).toBe(2);
});
