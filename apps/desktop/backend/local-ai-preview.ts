import { findErrorLine } from "../src/utils/error-line";
import { getClipboardItem, persistPreviewActionResult } from "./database";
import {
  ClipboardItemAction,
  ClipboardItemActionsVersion,
  getCachedActions,
  hasClipboardAction,
} from "./item-actions";
import { classifyLocalAiText, getLocalAiStatus } from "./local-ai";

export async function suggestLocalAiAction(id: unknown, app: TinyApp) {
  if (typeof id !== "string" || !(await getLocalAiStatus(app)).enabled)
    return null;

  const cached = getCachedActions(id);
  if (cached && cached.actionsVersion >= ClipboardItemActionsVersion.localAi) {
    return hasClipboardAction(cached.actions, ClipboardItemAction.copyErrorLine)
      ? "copy-error-line"
      : null;
  }

  const item = await getClipboardItem(id, app);
  if (item?.kind !== "text") return null;
  if (
    typeof item.actions === "number" &&
    typeof item.actionsVersion === "number" &&
    item.actionsVersion >= ClipboardItemActionsVersion.localAi
  ) {
    return hasClipboardAction(item.actions, ClipboardItemAction.copyErrorLine)
      ? "copy-error-line"
      : null;
  }
  if (
    item.secrets.length ||
    item.link ||
    !item.text ||
    !findErrorLine(item.text)
  )
    return null;

  const answer = await classifyLocalAiText("preview", item.text, app);
  if (answer === "stack_trace" || answer === "other") {
    await persistPreviewActionResult(id, answer === "stack_trace", app);
  }
  return answer === "stack_trace" ? "copy-error-line" : null;
}
