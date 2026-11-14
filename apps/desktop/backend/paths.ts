import { devFolder } from "./dev-data";
import { isDevRun } from "./dev-run";

let pathsPromise: Promise<TinyPaths> | null = null;

/** The app's folders. Asked for once: history rows turn up in the hundreds. */
export function appPaths(app: TinyApp): Promise<TinyPaths> {
  pathsPromise ??= resolvePaths(app);
  return pathsPromise;
}

// Every caller gets its folders from here, so this is the one place a dev run
// is kept off the installed app's history, images and link previews.
async function resolvePaths(app: TinyApp): Promise<TinyPaths> {
  const paths = await app.paths();
  if (!isDevRun()) return paths;
  const data = devFolder(paths.data);
  const cache = devFolder(paths.cache);
  await Promise.all(
    [data, cache].map((folder) => tjs.makeDir(folder, { recursive: true })),
  );
  return { ...paths, data, cache };
}
