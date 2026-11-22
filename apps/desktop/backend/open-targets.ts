// What the pages may hand to the OS. They have no shell.open of their own (see
// "api" in tinyjs.json): a link opens only if it is a web, mail or phone
// link, and a file only if it belongs to an item in the history.
import { getClipboardItem } from "./database";

const linkProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

/** The link as the OS should get it, or null when it isn't one to open. */
export function openableLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return linkProtocols.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function openLink(value: unknown, app: TinyApp): Promise<void> {
  const link = openableLink(value);
  if (!link) throw new Error("Teneo only opens web, mail and phone links.");
  await app.shell.open(link);
}

/** Leave opening and revealing to the OS rather than probing copied paths
 * ourselves, which can request folder access before Finder even opens. */
async function itemFiles(id: unknown, app: TinyApp): Promise<string[]> {
  if (typeof id !== "string") return [];
  const item = await getClipboardItem(id, app);
  if (!item) return [];
  const paths =
    item.kind === "image"
      ? [item.image].filter((path) => path !== null)
      : item.kind === "files"
        ? item.paths
        : [];
  return paths;
}

export async function openItemFiles(id: unknown, app: TinyApp): Promise<void> {
  const paths = await itemFiles(id, app);
  await Promise.all(paths.map((path) => app.shell.open(path)));
}

export async function revealItemFile(id: unknown, app: TinyApp): Promise<void> {
  const [path] = await itemFiles(id, app);
  if (path) await app.shell.reveal(path);
}
