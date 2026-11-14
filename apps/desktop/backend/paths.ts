let pathsPromise: Promise<TinyPaths> | null = null;

/** The app's folders. Asked for once: history rows turn up in the hundreds. */
export function appPaths(app: TinyApp): Promise<TinyPaths> {
  pathsPromise ??= app.paths();
  return pathsPromise;
}
