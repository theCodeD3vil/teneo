import type { DataFolderUsage } from "../shared/types/storage";
import { countClipboardMedia, listClipboardItemSizes } from "./database";

export async function getDataFolderUsage(
  app: TinyApp,
): Promise<DataFolderUsage> {
  const [size, itemSizes, counts] = await Promise.all([
    getFolderSize(app.paths.data),
    listClipboardItemSizes(app),
    countClipboardMedia(app),
  ]);
  const clipboardSizeByKind = { text: 0, image: 0, files: 0, color: 0 };
  // Pinned items don't count toward the storage limit, so the bar leaves them out
  let itemCount = 0;
  for (const { kind, bytes, pinned } of itemSizes) {
    if (!pinned) itemCount += 1;
    if (!pinned && kind in clipboardSizeByKind) {
      clipboardSizeByKind[kind as keyof typeof clipboardSizeByKind] += bytes;
    }
  }
  return { size, clipboardSizeByKind, itemCount, ...counts };
}

/** Total bytes of every file in folder and its subfolders. */
async function getFolderSize(folder: string): Promise<number> {
  let size = 0;
  let entries: AsyncIterable<{ name: string; isDirectory: boolean }>;
  try {
    entries = await tjs.readDir(folder);
  } catch {
    return 0; // nothing saved yet
  }
  for await (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    size += entry.isDirectory
      ? await getFolderSize(path)
      : // a file deleted mid-walk (e.g. by history trimming) counts as 0
        await tjs.stat(path).then(
          (stat: { size: number }) => stat.size,
          () => 0,
        );
  }
  return size;
}
