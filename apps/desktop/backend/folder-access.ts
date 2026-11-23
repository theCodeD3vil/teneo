// macOS keeps apps out of Desktop, Documents and Downloads until the user
// allows each one. Teneo reads a copied file there for its preview and size,
// so Teneo asks before enabling a folder. Remember that explicit choice
// without opening any folders to refresh their status on startup.
import {
  type FolderAccess,
  type FolderAccessStatus,
  folderAccessChangedEvent,
} from "@teneo/shared/types/storage";

import { devName } from "./dev-run";
import { appPaths } from "./paths";

const protectedFolders = ["Desktop", "Documents", "Downloads"] as const;
const preference = "folderPreviews";

interface FolderAccessOptions {
  home: () => string | undefined;
  probe: (path: string) => Promise<FolderAccess["status"]>;
  load: () => Promise<unknown>;
  save: (folders: FolderAccess["name"][]) => Promise<boolean>;
}

export function createFolderAccess({
  home,
  probe,
  load,
  save,
}: FolderAccessOptions) {
  const failures: FolderAccessStatus = {};
  let loaded: Promise<Set<FolderAccess["name"]>> | undefined;
  let changes = Promise.resolve();
  function enabledFolders() {
    loaded ??= load()
      .then(
        (saved) =>
          new Set(
            protectedFolders.filter(
              (name) => Array.isArray(saved) && saved.includes(name),
            ),
          ),
      )
      .catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
    return loaded;
  }
  async function status(): Promise<FolderAccessStatus> {
    const enabled = await enabledFolders();
    const result = { ...failures };
    for (const name of enabled) result[name] = "granted";
    return result;
  }
  return {
    status,
    async change(value: unknown, enable: unknown): Promise<FolderAccessStatus> {
      const name = protectedFolders.find((item) => item === value);
      const directory = home();
      if (!name || !directory || typeof enable !== "boolean")
        throw new Error("Choose a folder and whether to enable previews.");
      const updated = changes.then(async () => {
        const enabled = new Set(await enabledFolders());
        if (enable === enabled.has(name)) return status();
        if (enable) {
          const result = await probe(`${directory}/${name}`);
          if (result !== "granted") {
            failures[name] = result;
            return status();
          }
          enabled.add(name);
        } else {
          enabled.delete(name);
        }
        if (!(await save([...enabled])))
          throw new Error("Couldn't save the folder preview setting.");
        loaded = Promise.resolve(enabled);
        delete failures[name];
        return status();
      });
      changes = updated.then(
        () => undefined,
        () => undefined,
      );
      return updated;
    },
    async allows(path: string): Promise<boolean> {
      const directory = home();
      if (!directory || path.split("/").includes("..")) return false;
      for (const name of await enabledFolders()) {
        const root = `${directory}/${name}`;
        if (path === root || path.startsWith(`${root}/`)) return true;
      }
      return false;
    },
  };
}

let folderAccess: ReturnType<typeof createFolderAccess> | undefined;

function accessFor(app: TinyApp) {
  folderAccess ??= createFolderAccess({
    home: () => tjs.env.HOME,
    probe: openFolder,
    load: () => app.store.get(devName(preference)),
    save: (folders) => app.store.set(devName(preference), folders),
  });
  return folderAccess;
}

/** Reports Teneo's saved choices, not a live macOS permission check. */
export function folderAccessStatus(app: TinyApp): Promise<FolderAccessStatus> {
  return accessFor(app).status();
}

export async function setFolderPreviews(
  value: unknown,
  enabled: unknown,
  app: TinyApp,
): Promise<FolderAccessStatus> {
  const result = await accessFor(app).change(value, enabled);
  app.push(folderAccessChangedEvent, result);
  return result;
}

/** Inspect only app-owned paths and folders the user explicitly enabled.
 * macOS still enforces its permission on each actual file access. */
export async function mayInspectFile(
  path: string,
  app: TinyApp,
): Promise<boolean> {
  if (path.split("/").includes("..")) return false;
  const own = await appPaths(app);
  return (
    [own.data, own.cache].some(
      (root) => path === root || path.startsWith(`${root}/`),
    ) ||
    (await accessFor(app)
      .allows(path)
      .catch(() => false))
  );
}

async function openFolder(path: string): Promise<FolderAccess["status"]> {
  try {
    const entries = await tjs.readDir(path);
    // reading an entry, not just opening, is what macOS checks
    try {
      await entries.next();
    } finally {
      await entries.close();
    }
    return "granted";
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code === "ENOENT" ? "missing" : "denied";
  }
}
