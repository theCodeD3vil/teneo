// macOS keeps apps out of Desktop, Documents and Downloads until the user
// allows each one. Teneo reads a copied file there for its preview and size,
// so setup asks up front, where a prompt is expected, rather than the first
// time the panel lists such a file. There's no way to check without asking:
// opening the folder is what makes macOS show its prompt.
import type { FolderAccess } from "../shared/types/storage";

const protectedFolders = ["Desktop", "Documents", "Downloads"] as const;

/** Open each folder in turn, so macOS asks about one at a time. */
export async function requestFolderAccess(): Promise<FolderAccess[]> {
  const results: FolderAccess[] = [];
  for (const name of protectedFolders) {
    results.push({ name, status: await openFolder(`${tjs.env.HOME}/${name}`) });
  }
  return results;
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
