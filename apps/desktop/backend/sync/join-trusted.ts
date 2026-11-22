import {
  type DeviceIdentity,
  joinTrustedVault,
  parseEnrollmentLink,
  type VaultTrust,
} from "@teneo/sync";

import { isLocalNetworkAddress, isLoopbackAddress } from "./local-address";
import { SocketChannel } from "./ws-channel";

type Invite = NonNullable<ReturnType<typeof parseEnrollmentLink>>;

export async function joinFromInvite(
  identity: DeviceIdentity,
  invite: Invite,
  persist: (trust: VaultTrust) => Promise<void>,
): Promise<void> {
  for (const address of invite.addresses) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(address);
    if (
      !match ||
      !isLocalNetworkAddress(match[1]!) ||
      isLoopbackAddress(match[1]!) ||
      Number(match[2]) < 1 ||
      Number(match[2]) > 65535
    )
      continue;
    const connected = await dial(address);
    if (!connected) continue;
    // Once reached, do not retry into the single-use invitation or hide a
    // rejected approval behind a different interface's connection error.
    await joinTrustedVault(connected, identity, invite, persist);
    return;
  }
  throw new Error("Can't reach the primary Mac on this local network.");
}

function dial(address: string): Promise<SocketChannel | null> {
  return new Promise((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://${address}`);
    } catch {
      resolve(null);
      return;
    }
    const channel = new SocketChannel({
      initiator: true,
      remoteAddress: address,
      socket: {
        send: (message) => socket.send(message),
        close: () => {
          try {
            socket.close();
          } catch {
            // A failed connection may already be gone.
          }
        },
      },
    });
    const timer = setTimeout(() => {
      channel.close();
      resolve(null);
    }, 3_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(channel);
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") channel.deliver(event.data);
    };
    socket.onclose = () => {
      clearTimeout(timer);
      channel.ended();
      resolve(null);
    };
  });
}
