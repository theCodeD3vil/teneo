// Where the bytes of the history's images are, for sync. An image record
// names its picture by the hash of its file; this hands the file to a device
// that asks for it, a piece at a time, and takes one that arrives.
//
// A row that came from another device has no file until its bytes are in
// (path NULL): it isn't listed until then. Bytes from another device are
// untrusted: they are kept only when a row waits for exactly that hash and
// length, the whole has that hash, and it starts as its kind of image does.
import {
  type Bytes,
  type ImageStore,
  imageTypes,
  maxImageBytes,
  toHex,
} from "@teneo/sync";

import { initializeDatabase } from "../database";
import { fileExists, logError } from "../files";
import { appPaths } from "../paths";
import { all, exclusive, run } from "../sqlite";
import { clipboardHistoryChangedEvent } from "../types/clipboard";
import { generateUUID } from "../utils/uuid-generator";

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** The kind of image a saved file is, by its name; null for one that isn't
 *  synced (see imageTypes). */
export function imageTypeOfPath(path: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (extension === "jpeg") return "image/jpeg";
  return (
    Object.entries(extensions).find(([, known]) => known === extension)?.[0] ??
    null
  );
}

/** Whether bytes begin the way an image of this kind does. */
export function looksLikeImage(type: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (type === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (type === "image/gif") return starts(0x47, 0x49, 0x46, 0x38);
  if (type === "image/webp") {
    // "RIFF", four bytes of length, "WEBP"
    return (
      starts(0x52, 0x49, 0x46, 0x46) &&
      [0x57, 0x45, 0x42, 0x50].every((byte, index) => bytes[8 + index] === byte)
    );
  }
  return false;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  );
}

/** A path in the data folder as a row keeps it, made whole; null for one
 *  that would lead out of the folder. */
function fullPath(path: string | null, dataDirectory: string): string | null {
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  return `${dataDirectory}/${path}`;
}

interface LocalImage {
  id: string;
  path: string | null;
  imageHash: string | null;
  imageBytes: number | null;
  imageType: string | null;
}

/** What a record needs to know of an image copied here, worked out from its
 *  file the first time it is sent and kept with the row. Null for an image
 *  that can't be synced: its file is gone, too large, or of another kind. */
export async function measureImage(
  row: { id: string; path?: string | null },
  app: TinyApp,
): Promise<{
  imageHash: string;
  imageBytes: number;
  imageType: string;
} | null> {
  const { data } = await appPaths(app);
  const path = fullPath(row.path ?? null, data);
  const imageType = path && imageTypeOfPath(path);
  if (!path || !imageType) return null;
  try {
    const { size } = await tjs.stat(path);
    if (size < 1 || size > maxImageBytes) return null;
    const bytes = await tjs.readFile(path);
    if (!looksLikeImage(imageType, bytes)) return null;
    const measured = {
      imageHash: await sha256(bytes),
      imageBytes: bytes.length,
      imageType,
    };
    const database = await initializeDatabase(app);
    await exclusive(async () => {
      run(
        database,
        `
          UPDATE "CLIPBOARD_ITEMS" SET imageHash = ?, imageBytes = ?, imageType = ?
          WHERE id = ? AND imageHash IS NULL
        `,
        measured.imageHash,
        measured.imageBytes,
        measured.imageType,
        row.id,
      );
    });
    return measured;
  } catch (error) {
    logError(`measuring the image of ${row.id} failed:`, error);
    return null;
  }
}

export class SqliteImageStore implements ImageStore {
  private readonly app: TinyApp;

  constructor(app: TinyApp) {
    this.app = app;
  }

  /** The rows that wait for the file with this hash. */
  private async waiting(hash: string): Promise<LocalImage[]> {
    return all<LocalImage>(
      await initializeDatabase(this.app),
      `
        SELECT id, path, imageHash, imageBytes, imageType FROM "CLIPBOARD_ITEMS"
        WHERE kind = 'image' AND deletedAt IS NULL AND path IS NULL AND imageHash = ?
      `,
      hash,
    );
  }

  /** A row that has the file with this hash, and the file. */
  private async holder(
    hash: string,
  ): Promise<{ path: string; bytes: number } | null> {
    const { data } = await appPaths(this.app);
    const rows = all<LocalImage>(
      await initializeDatabase(this.app),
      `
        SELECT id, path, imageHash, imageBytes, imageType FROM "CLIPBOARD_ITEMS"
        WHERE kind = 'image' AND deletedAt IS NULL AND path IS NOT NULL AND imageHash = ?
      `,
      hash,
    );
    for (const row of rows) {
      const path = fullPath(row.path, data);
      const size = path
        ? await tjs.stat(path).then(
            (stats) => stats.size,
            () => null,
          )
        : null;
      // a file changed since it was measured is not the one that was asked for
      if (path && size !== null && size === row.imageBytes) {
        return { path, bytes: size };
      }
    }
    return null;
  }

  /** Give every row that waits for this hash a copy of `source`, each its
   *  own: a row's file goes when the row does. */
  private async hand(hash: string, source: string): Promise<void> {
    const { data } = await appPaths(this.app);
    const database = await initializeDatabase(this.app);
    const folder = `${data}/images`;
    await tjs.makeDir(folder, { recursive: true });
    for (const row of await this.waiting(hash)) {
      const extension = extensions[row.imageType ?? ""] ?? "png";
      const name = `images/${generateUUID()}-synced.${extension}`;
      await tjs.copyFile(source, `${data}/${name}`);
      await exclusive(async () => {
        run(
          database,
          `
            UPDATE "CLIPBOARD_ITEMS" SET path = ?
            WHERE id = ? AND path IS NULL AND deletedAt IS NULL
          `,
          name,
          row.id,
        );
      });
    }
  }

  async missing(): Promise<string[]> {
    const hashes = all<{ imageHash: string }>(
      await initializeDatabase(this.app),
      `
        SELECT DISTINCT imageHash FROM "CLIPBOARD_ITEMS"
        WHERE kind = 'image' AND deletedAt IS NULL AND path IS NULL AND imageHash IS NOT NULL
      `,
    ).map((row) => row.imageHash);
    const missing: string[] = [];
    let found = false;
    for (const hash of hashes) {
      // the same picture is already here, under another item
      const held = await this.holder(hash);
      if (held) {
        await this.hand(hash, held.path);
        found = true;
      } else missing.push(hash);
    }
    if (found) this.app.push(clipboardHistoryChangedEvent);
    return missing;
  }

  async size(hash: string): Promise<number | null> {
    return (await this.holder(hash))?.bytes ?? null;
  }

  async read(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Bytes | null> {
    const held = await this.holder(hash);
    if (!held || offset + length > held.bytes) return null;
    const file = await tjs.open(held.path, "r");
    try {
      const piece = new Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        const count = await file.read(piece.subarray(filled), offset + filled);
        if (!count) return null; // shorter than it was
        filled += count;
      }
      return piece;
    } finally {
      await file.close();
    }
  }

  private async partPath(hash: string): Promise<string> {
    const { cache } = await appPaths(this.app);
    const folder = `${cache.replace(/\/$/, "")}/sync-images`;
    await tjs.makeDir(folder, { recursive: true });
    return `${folder}/${hash}.part`;
  }

  async write(
    hash: string,
    offset: number,
    total: number,
    piece: Bytes,
  ): Promise<"more" | "done" | "refused"> {
    const part = await this.partPath(hash);
    const refuse = async () => {
      await tjs.remove(part).catch(() => undefined);
      return "refused" as const;
    };
    const waiting = await this.waiting(hash);
    const expected = waiting[0];
    if (
      !expected ||
      expected.imageBytes !== total ||
      total > maxImageBytes ||
      !imageTypes.includes(expected.imageType ?? "") ||
      piece.length === 0 ||
      offset + piece.length > total
    ) {
      return refuse();
    }
    // pieces come in order: what is there so far must end where this begins
    const sofar =
      offset === 0
        ? 0
        : await tjs.stat(part).then(
            (stats) => stats.size,
            () => -1,
          );
    if (sofar !== offset) return refuse();

    const file = await tjs.open(part, offset === 0 ? "w" : "r+");
    try {
      let written = 0;
      while (written < piece.length) {
        written += await file.write(piece.subarray(written), offset + written);
      }
    } finally {
      await file.close();
    }
    if (offset + piece.length < total) return "more";

    const whole = await tjs.readFile(part);
    if (
      whole.length !== total ||
      !looksLikeImage(expected.imageType!, whole) ||
      (await sha256(whole)) !== hash
    ) {
      return refuse();
    }
    await this.hand(hash, part);
    await tjs.remove(part).catch(() => undefined);
    return "done";
  }
}

/** Forget pieces of images that never finished arriving: each is asked for
 *  again from its start. */
export async function clearPartialImages(app: TinyApp): Promise<void> {
  const { cache } = await appPaths(app);
  const folder = `${cache.replace(/\/$/, "")}/sync-images`;
  if (await fileExists(folder)) {
    await tjs.remove(folder).catch(() => undefined);
  }
}
