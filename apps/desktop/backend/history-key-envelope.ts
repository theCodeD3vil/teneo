import { fromBase64, timingSafeEqual, toBase64, utf8 } from "@teneo/sync";

export interface HistoryKeyEnvelope {
  representation: string;
  ephemeral: string;
  sealed: string;
  requireAuthentication: boolean;
}

export const historyProtectionChangedEvent = "history-protection-changed";
export const historySecretsLockedEvent = "history-secrets-locked";

export interface HistoryProtectionStatus {
  available: boolean;
  protected: boolean;
  requireAuthentication: boolean;
  locked: boolean;
  unreadable?: boolean;
  needsKeychainAccess?: boolean;
}

function field(value: unknown, length?: number): value is string {
  if (typeof value !== "string" || !value || value.length > 5500) return false;
  const decoded = fromBase64(value);
  return !!decoded && (length === undefined || decoded.length === length);
}

export function readHistoryKeyEnvelope(value: unknown): HistoryKeyEnvelope {
  const envelope = value as Partial<HistoryKeyEnvelope> | null;
  if (
    !field(envelope?.representation) ||
    !field(envelope.ephemeral, 65) ||
    !field(envelope.sealed, 60) ||
    typeof envelope.requireAuthentication !== "boolean"
  )
    throw new Error("Teneo's protected history key is unreadable.");
  return {
    representation: envelope.representation,
    ephemeral: envelope.ephemeral,
    sealed: envelope.sealed,
    requireAuthentication: envelope.requireAuthentication,
  };
}

type Request =
  | { operation: "available" }
  | {
      operation: "protect-history";
      message: string;
      requireAuthentication: boolean;
    }
  | {
      operation: "open-history";
      envelope: HistoryKeyEnvelope;
      allowInteraction: boolean;
    };

async function invoke(app: TinyApp, request: Request) {
  const directory = (await app.paths()).executables;
  if (!directory)
    throw new Error("The Secure Enclave helper is not installed.");
  const child = tjs.spawn([`${directory}/teneo-sync-device-identity`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const timer = setTimeout(
    () => child.kill("SIGTERM"),
    request.operation === "open-history" && request.allowInteraction
      ? 90_000
      : 5_000,
  );
  try {
    const input = child.stdin!.getWriter();
    const send = async () => {
      await input.write(utf8(JSON.stringify(request)));
      await input.close();
    };
    const [text, exit] = await Promise.all([
      new Response(child.stdout).text(),
      child.wait(),
      send(),
    ]);
    if (exit.exit_status !== 0 || text.length > 8192)
      throw new Error("Secure Enclave operation failed");
    return JSON.parse(text) as { envelope?: unknown; key?: string };
  } catch {
    child.kill("SIGTERM");
    throw new Error(
      "Teneo couldn't use Secure Enclave. Check that this Mac supports it and that authentication was completed.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function historyHardwareAvailable(app: TinyApp): Promise<boolean> {
  return invoke(app, { operation: "available" }).then(
    () => true,
    () => false,
  );
}

export async function openHistoryKeyEnvelope(
  app: TinyApp,
  envelope: HistoryKeyEnvelope,
  allowInteraction: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const { key } = await invoke(app, {
    operation: "open-history",
    envelope,
    allowInteraction,
  });
  const raw = typeof key === "string" ? fromBase64(key) : null;
  if (raw?.length !== 32)
    throw new Error("The protected history key is invalid.");
  return raw;
}

export async function createVerifiedHistoryKeyEnvelope(
  app: TinyApp,
  raw: Uint8Array<ArrayBuffer>,
  requireAuthentication: boolean,
): Promise<HistoryKeyEnvelope> {
  const result = await invoke(app, {
    operation: "protect-history",
    message: toBase64(raw),
    requireAuthentication,
  });
  const envelope = readHistoryKeyEnvelope(result.envelope);
  if (envelope.requireAuthentication !== requireAuthentication)
    throw new Error("Secure Enclave did not apply the requested protection.");
  const verified = await openHistoryKeyEnvelope(
    app,
    envelope,
    requireAuthentication,
  );
  try {
    if (!timingSafeEqual(verified, raw))
      throw new Error("Secure Enclave could not recover the new history key.");
    return envelope;
  } finally {
    verified.fill(0);
  }
}
