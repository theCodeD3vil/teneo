import { expect, test } from "bun:test";

import { isLocalNetworkAddress } from "./local-address";

test("private, link-local and loopback addresses are allowed", () => {
  for (const address of [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.43.1",
    "169.254.10.20",
    "::1",
    "fe80::1ff:fe23:4567:890a",
    "fd12:3456:789a::1",
    "fc00::1",
  ]) {
    expect(isLocalNetworkAddress(address)).toBe(true);
  }
});

test("public addresses are not", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "100.64.0.1", // carrier-grade NAT is not the local network
    "169.255.0.1",
    "2001:4860:4860::8888",
    "fec0::1",
  ]) {
    expect(isLocalNetworkAddress(address)).toBe(false);
  }
});

test("an IPv4 address written as IPv6 is judged as the IPv4 address", () => {
  expect(isLocalNetworkAddress("::ffff:192.168.1.7")).toBe(true);
  expect(isLocalNetworkAddress("::ffff:8.8.8.8")).toBe(false);
});

test("what is not an address is refused, not waved through", () => {
  for (const text of [
    "",
    "localhost",
    "example.com",
    "10.0.0",
    "10.0.0.256",
    "10.0.0.1.5",
    "::",
    "undefined",
    "10.0.0.1 ",
  ]) {
    expect(isLocalNetworkAddress(text)).toBe(false);
  }
});
