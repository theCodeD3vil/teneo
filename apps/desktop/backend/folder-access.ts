// macOS keeps apps out of Desktop, Documents and Downloads until the user
// allows each one. Teneo reads a copied file there for its preview and size,
// so setup asks up front, where a prompt is expected, rather than the first
// time the panel lists such a file. There's no way to check without asking:
// opening the folder is what makes macOS show its prompt.
import type { FolderAccess } from "@teneo/shared/types/storage";

import { appPaths } from "./paths";

const protectedFolders = ["Desktop", "Documents", "Downloads"] as const;
const grantedRoots = new Set<string>();

/** Only probe the particular folder the user chose. No silent TCC preflight
 * for these folders is available through the runtime. */
export async function requestFolderAccess(
  value: unknown,
): Promise<FolderAccess> {
  const name = protectedFolders.find((item) => item === value);
  if (!name || !tjs.env.HOME) throw new Error("Choose a folder to allow.");
  const path = `${tjs.env.HOME}/${name}`;
  const status = await openFolder(path);
  if (status === "granted") grantedRoots.add(path);
  else grantedRoots.delete(path);
  return { name, status };
}

/** Do not probe unknown copied paths for previews or size. Each launch starts
 * with no grants for external folders, so revoking in macOS cannot surprise
 * the user with a prompt on the next launch. */
export async function mayInspectFile(
  path: string,
  app: TinyApp,
): Promise<boolean> {
  if (path.split("/").includes("..")) return false;
  const own = await appPaths(app);
  return [own.data, own.cache, ...grantedRoots].some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

async function openFolder(path: string): Promise<FolderAccess["status"]> {
  try {
    const entries = await tjs.readDir(path);
    // reading an entry, not just opening, is what macOS checks
    await entries.next();
    await entries.close();
    return "granted";
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code === "ENOENT" ? "missing" : "denied";
  }
}
