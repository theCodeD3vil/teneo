// Transport tests that need the real runtime, because the transport listens and
// connects with it: who may connect, and whom it may dial. The engine and the
// discovery are stubs and everything stays on this machine. Run with
// `bun run test:runtime` from apps/desktop.
/* oxlint-disable no-console -- a test run reports on the console */
import type { SyncEngine } from "@teneo/sync";

import type { Discovery, DiscoveryOptions } from "./discovery";
import { LanTransport } from "./lan-transport";
import { check, finish, same, test } from "./runtime-test";

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 3000; waited += 50) {
    if (condition()) return;
    await delay(50);
  }
  throw new Error(`timed out: ${what}`);
}

/** The engine as the transport sees it, counting the connections handed over. */
function stubEngine() {
  const attached: unknown[] = [];
  const engine = {
    discoveryTag: async () => "test-tag",
    attach: async (channel: unknown) => {
      attached.push(channel);
      return null;
    },
    peers: () => [],
  } as unknown as SyncEngine;
  return { engine, attached };
}

class StubDiscovery implements Discovery {
  options: DiscoveryOptions | null = null;
  start(options: DiscoveryOptions): void {
    this.options = options;
  }
  restart(): void {}
  stop(): void {}
  async defaultGateway(): Promise<string | null> {
    return null;
  }
}

// away from the ports Teneo itself listens on
let nextPort = 47931;

interface Started {
  port: number;
  attached: unknown[];
  discovery: StubDiscovery;
}

/** A transport on a port of its own, stopped when `body` is done. */
async function withTransport(
  isLocalAddress: ((address: string) => boolean) | undefined,
  body: (started: Started) => Promise<void>,
  allowLoopback = true,
): Promise<void> {
  const { engine, attached } = stubEngine();
  const discovery = new StubDiscovery();
  const transport = new LanTransport({
    engine,
    deviceId: "me",
    discovery,
    knownPeers: async () => [],
    ports: [nextPort++],
    isLocalAddress,
    allowLoopback,
  });
  await transport.start();
  try {
    const port = transport.port;
    check(port !== null, "the transport found a port");
    await body({ port, attached, discovery });
  } finally {
    await transport.stop();
  }
}

/** Whether a WebSocket to `url` opened; it is closed again at once. */
function opensWebSocket(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let opened = false;
    const socket = new WebSocket(url);
    socket.onopen = () => {
      opened = true;
      socket.close();
    };
    socket.onerror = () => {};
    socket.onclose = () => resolve(opened);
  });
}

/** A server that only counts the WebSockets opened to it. */
function countingServer(port: number) {
  const seen = { opened: 0 };
  const server = tjs.serve({
    port,
    listenIp: "127.0.0.1",
    fetch: (request, context) =>
      context.server.upgrade(request, { data: {} })
        ? undefined
        : new Response("no", { status: 400 }),
    websocket: {
      open: () => {
        seen.opened += 1;
      },
      message: () => {},
      close: () => {},
      error: () => {},
    },
  });
  return { seen, close: () => server.close() };
}

await test("an address the filter refuses gets 403 and never reaches the engine", async () => {
  await withTransport(
    () => false,
    async ({ port, attached }) => {
      const reply = await fetch(`http://127.0.0.1:${port}/`);
      same(reply.status, 403, "the plain request");
      same(
        await opensWebSocket(`ws://127.0.0.1:${port}`),
        false,
        "the WebSocket opened",
      );
      same(attached.length, 0, "connections handed to the engine");
    },
  );
});

await test("a local address is let in, and a plain web request is told to upgrade", async () => {
  await withTransport(undefined, async ({ port, attached }) => {
    const reply = await fetch(`http://127.0.0.1:${port}/`);
    same(reply.status, 426, "the plain request");
    same(
      await opensWebSocket(`ws://127.0.0.1:${port}`),
      true,
      "the WebSocket opened",
    );
    await until(
      () => attached.length === 1,
      "the engine to get the connection",
    );
  });
});

await test("a web page's request is turned away before it costs a try", async () => {
  await withTransport(undefined, async ({ port, attached }) => {
    const fromPage = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { origin: "https://tracker.example" },
    });
    same(fromPage.status, 403, "a request with a page's origin");
    const withFetchHeaders = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "sec-fetch-mode": "websocket" },
    });
    same(withFetchHeaders.status, 403, "a request a browser marked");
    // the Mac's own WebSocket names the server as its origin, and gets in
    same(
      await opensWebSocket(`ws://127.0.0.1:${port}`),
      true,
      "a Teneo WebSocket opened",
    );
    await until(() => attached.length === 1, "the engine to get it");
  });
});

await test("this Mac itself is refused unless a test or dev run allows it", async () => {
  await withTransport(
    undefined,
    async ({ port, attached }) => {
      const reply = await fetch(`http://127.0.0.1:${port}/`);
      same(reply.status, 403, "a request from 127.0.0.1");
      same(attached.length, 0, "connections handed to the engine");
    },
    false,
  );
});

await test("a device is not dialed at an address the filter refuses", async () => {
  const target = countingServer(47940);
  try {
    await withTransport(
      () => false,
      async ({ discovery }) => {
        discovery.options?.onDevice({
          deviceId: "other",
          addresses: ["127.0.0.1"],
          port: 47940,
        });
        await delay(1500);
        same(target.seen.opened, 0, "connections made to the refused address");
      },
    );
  } finally {
    await target.close();
  }
});

await test("a device at a local address is dialed", async () => {
  const target = countingServer(47941);
  try {
    await withTransport(undefined, async ({ discovery }) => {
      discovery.options?.onDevice({
        deviceId: "other",
        addresses: ["127.0.0.1"],
        port: 47941,
      });
      await until(() => target.seen.opened >= 1, "the device to be dialed");
    });
  } finally {
    await target.close();
  }
});

finish();
