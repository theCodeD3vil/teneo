import { expect, test } from "bun:test";

import { hostWithoutPort, isFromWebPage } from "./browser-request";

const request = (headers: Record<string, string>) => new Headers(headers);

test("Teneo's own peers are let in", () => {
  // Android's WebSocket: no origin at all
  expect(isFromWebPage(request({ host: "192.168.1.7:47823" }))).toBe(false);
  // the Mac's (txiki), as measured: the address it connects to
  expect(
    isFromWebPage(
      request({ host: "192.168.1.7:47823", origin: "http://192.168.1.7" }),
    ),
  ).toBe(false);
  expect(isFromWebPage(request({ host: "::1", origin: "http://::1" }))).toBe(
    false,
  );
  expect(
    isFromWebPage(
      request({ host: "fe80::1:2:3:4", origin: "http://fe80::1:2:3:4" }),
    ),
  ).toBe(false);
});

test("a web page is turned away, from any site", () => {
  for (const headers of [
    { host: "127.0.0.1:47823", origin: "https://tracker.example" },
    { host: "127.0.0.1:47823", origin: "null" },
    // a page served from another port of the same address
    { host: "192.168.1.7:47823", origin: "http://192.168.1.7:8080" },
    // every current browser adds these, whatever the origin
    {
      host: "192.168.1.7:47823",
      origin: "http://192.168.1.7",
      "sec-fetch-mode": "websocket",
    },
    { host: "192.168.1.7:47823", "Sec-Fetch-Site": "cross-site" },
    { origin: "http://x" },
  ]) {
    expect(isFromWebPage(request(headers))).toBe(true);
  }
});

test("hostWithoutPort", () => {
  expect(hostWithoutPort("192.168.1.7:47823")).toBe("192.168.1.7");
  expect(hostWithoutPort("teneo.local")).toBe("teneo.local");
  expect(hostWithoutPort("[fe80::1]:47823")).toBe("[fe80::1]");
  expect(hostWithoutPort("::1")).toBe("::1");
});
