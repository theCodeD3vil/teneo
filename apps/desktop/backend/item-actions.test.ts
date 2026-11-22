import { describe, expect, test } from "bun:test";

import {
  ClipboardItemAction,
  ClipboardItemActionsVersion,
  hasClipboardAction,
} from "@teneo/shared/types/clipboard";

import {
  cachedActionCount,
  clearCachedActions,
  computeDeterministicActions,
  deleteCachedActions,
  getCachedActions,
  maxActionCacheItems,
  needsErrorLineCheck,
  setCachedActions,
} from "./item-actions";

describe("computeDeterministicActions", () => {
  test("detects tidy, JSON formatting, QR eligibility, and contacts", () => {
    const clean = computeDeterministicActions("hello world", false);
    expect(hasClipboardAction(clean, ClipboardItemAction.qr)).toBe(true);
    expect(hasClipboardAction(clean, ClipboardItemAction.tidy)).toBe(false);
    expect(hasClipboardAction(clean, ClipboardItemAction.formatJson)).toBe(
      false,
    );

    const messy = computeDeterministicActions(
      "  hello   \n\n\n  world  ",
      false,
    );
    expect(hasClipboardAction(messy, ClipboardItemAction.tidy)).toBe(true);
    expect(hasClipboardAction(messy, ClipboardItemAction.qr)).toBe(true);

    const compactJson = computeDeterministicActions(
      '{"service":"teneo","items":[1,2]}',
      false,
    );
    expect(
      hasClipboardAction(compactJson, ClipboardItemAction.formatJson),
    ).toBe(true);

    const formattedJson = computeDeterministicActions(
      JSON.stringify({ service: "teneo", items: [1, 2] }, null, 2),
      false,
    );
    expect(
      hasClipboardAction(formattedJson, ClipboardItemAction.formatJson),
    ).toBe(false);

    const longText = computeDeterministicActions("a".repeat(501), false);
    expect(hasClipboardAction(longText, ClipboardItemAction.qr)).toBe(false);

    const withEmail = computeDeterministicActions(
      "Reach support at support@example.com or +1 (415) 555-2671",
      false,
    );
    expect(
      hasClipboardAction(withEmail, ClipboardItemAction.contactEmail),
    ).toBe(true);
    expect(
      hasClipboardAction(withEmail, ClipboardItemAction.contactPhone),
    ).toBe(false);

    const withPhone = computeDeterministicActions(
      "Call +1 (415) 555-2671 when ready",
      false,
    );
    expect(
      hasClipboardAction(withPhone, ClipboardItemAction.contactPhone),
    ).toBe(true);
  });

  test("returns zero actions when secrets are present or text is empty", () => {
    expect(
      computeDeterministicActions(
        '{"email":"ops@example.com","note":"  extra  "}',
        true,
      ),
    ).toBe(0);
    expect(computeDeterministicActions("", false)).toBe(0);
    expect(computeDeterministicActions(null, false)).toBe(0);
  });

  test("flags stack trace candidates only when non-secret and non-link", () => {
    const stack =
      "TypeError: Cannot read properties of undefined\n    at build (src/app.ts:14:5)";
    expect(needsErrorLineCheck(stack, false, false)).toBe(true);
    expect(needsErrorLineCheck(stack, true, false)).toBe(false);
    expect(needsErrorLineCheck(stack, false, true)).toBe(false);
    expect(needsErrorLineCheck("Plain meeting notes", false, false)).toBe(
      false,
    );
  });
});

describe("bounded write-through LRU action cache", () => {
  test("evicts the least-recently-used item beyond maxActionCacheItems", () => {
    clearCachedActions();
    for (let index = 0; index < maxActionCacheItems; index += 1) {
      setCachedActions(`item-${index}`, {
        actions: ClipboardItemAction.qr,
        actionsVersion: ClipboardItemActionsVersion.deterministic,
      });
    }
    expect(cachedActionCount()).toBe(maxActionCacheItems);

    // Touch item-0 so item-1 becomes the oldest entry.
    expect(getCachedActions("item-0")?.actions).toBe(ClipboardItemAction.qr);

    setCachedActions(`item-${maxActionCacheItems}`, {
      actions: ClipboardItemAction.tidy,
      actionsVersion: ClipboardItemActionsVersion.localAi,
    });
    expect(cachedActionCount()).toBe(maxActionCacheItems);
    expect(getCachedActions("item-0")).toBeDefined();
    expect(getCachedActions("item-1")).toBeUndefined();
    expect(getCachedActions(`item-${maxActionCacheItems}`)).toEqual({
      actions: ClipboardItemAction.tidy,
      actionsVersion: ClipboardItemActionsVersion.localAi,
    });

    deleteCachedActions("item-0");
    expect(getCachedActions("item-0")).toBeUndefined();
    clearCachedActions();
    expect(cachedActionCount()).toBe(0);
  });
});
