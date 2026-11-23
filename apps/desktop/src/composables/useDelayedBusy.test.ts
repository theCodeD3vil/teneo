import { expect, test } from "bun:test";

import { effectScope, nextTick, ref } from "vue";

import { useDelayedBusy } from "./useDelayedBusy";

test("fast operations never show the indicator", async () => {
  const scope = effectScope();
  const busy = ref(false);
  try {
    const show = scope.run(() => useDelayedBusy(busy, 20))!;
    busy.value = true;
    await nextTick();
    expect(show.value).toBe(false);
    busy.value = false;
    await nextTick();
    await Bun.sleep(25);
    expect(show.value).toBe(false);
  } finally {
    scope.stop();
  }
});

test("a longer wait shows progress and clears it as soon as work finishes", async () => {
  const scope = effectScope();
  const busy = ref(true);
  try {
    const show = scope.run(() => useDelayedBusy(busy, 20))!;
    expect(show.value).toBe(false);
    await Bun.sleep(25);
    expect(show.value).toBe(true);
    busy.value = false;
    await nextTick();
    expect(show.value).toBe(false);
  } finally {
    scope.stop();
  }
});
