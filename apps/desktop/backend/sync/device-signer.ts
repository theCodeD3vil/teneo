import {
  type Bytes,
  type DeviceIdentity,
  fromBase64,
  parseDeviceIdentity,
  toBase64,
  utf8,
} from "@teneo/sync";

import { devName } from "../dev-run";
import { readKeychain } from "../keychain";

const account = () => devName("sync-device-identity-v1");
const helper = "teneo-sync-device-identity";

type Request =
  | { operation: "create" }
  | { operation: "public"; representation: string }
  | { operation: "sign"; representation: string; message: string };

async function call(path: string, request: Request) {
  const child = tjs.spawn([path], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 5_000);
  try {
    const writer = child.stdin!.getWriter();
    const send = async () => {
      await writer.write(utf8(JSON.stringify(request)));
      await writer.close();
    };
    const read = async () => {
      const reader = child.stdout!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return text + decoder.decode();
        length += value.length;
        if (length > 8_192)
          throw new Error("The sync identity helper returned too much data");
        text += decoder.decode(value, { stream: true });
      }
    };
    const [text, exit] = await Promise.all([read(), child.wait(), send()]);
    if (exit.exit_status !== 0)
      throw new Error("Secure Enclave is unavailable");
    return JSON.parse(text) as {
      publicKey?: string;
      representation?: string;
      signature?: string;
    };
  } catch {
    child.kill("SIGTERM");
    throw new Error("Teneo couldn't use a Secure Enclave sync identity");
  } finally {
    clearTimeout(timer);
  }
}

/** Explicit enrollment may create a signer. Normal startup may only open the
 *  existing one. The Keychain entry is an opaque device-bound representation,
 *  not the underlying private key. */
export async function openDeviceSigner(
  app: TinyApp,
  deviceId: string,
  create: boolean,
  interactive = true,
): Promise<DeviceIdentity> {
  const directory = (await app.paths()).executables;
  if (!directory) throw new Error("The sync identity helper was not installed");
  const path = `${directory}/${helper}`;
  let representation = await readKeychain(app, account(), interactive);
  let response;
  if (representation) {
    response = await call(path, { operation: "public", representation });
  } else {
    if (!create) throw new Error("This Mac's sync identity is missing");
    response = await call(path, { operation: "create" });
    representation = response.representation ?? null;
    if (!representation || !(await app.secrets.set(account(), representation)))
      throw new Error("Teneo couldn't keep this Mac's sync identity");
  }
  const device = parseDeviceIdentity({
    deviceId,
    publicKey: response.publicKey,
  });
  if (!device) throw new Error("This Mac's sync identity has no public key");
  const saved = representation;
  return {
    ...device,
    async sign(message: Bytes) {
      const { signature } = await call(path, {
        operation: "sign",
        representation: saved,
        message: toBase64(message),
      });
      const bytes = signature ? fromBase64(signature) : null;
      if (bytes?.length !== 64)
        throw new Error("This Mac's sync identity could not sign");
      return bytes;
    },
  };
}
