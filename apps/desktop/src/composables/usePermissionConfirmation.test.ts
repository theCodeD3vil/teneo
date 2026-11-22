import { expect, test } from "bun:test";

import { usePermissionConfirmation } from "./usePermissionConfirmation";

const explanation = {
  title: "Allow access?",
  description: "Teneo needs this permission for the feature you chose.",
  action: "Allow access",
};

test("opening or cancelling the explanation never performs the OS request", () => {
  const dialog = usePermissionConfirmation();
  let requests = 0;
  dialog.explain(explanation, () => requests++);
  expect(dialog.prompt.value).toBe(explanation);
  expect(requests).toBe(0);
  dialog.cancel();
  dialog.confirm();
  expect(requests).toBe(0);
});

test("confirm performs the selected request only once", () => {
  const dialog = usePermissionConfirmation();
  const requested: string[] = [];
  dialog.explain(explanation, () => requested.push("old"));
  dialog.explain(explanation, () => requested.push("selected"));
  dialog.confirm();
  dialog.confirm();
  expect(dialog.prompt.value).toBeNull();
  expect(requested).toEqual(["selected"]);
});
