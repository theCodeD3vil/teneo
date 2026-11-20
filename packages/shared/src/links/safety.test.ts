import { expect, test } from "bun:test";

import { canOpenPage, isLocalAddress, isLocalIp } from "./safety";

const isLocal = (url: string) => isLocalAddress(new URL(url));

test("addresses on this Mac or the local network are blocked", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://router/",
    "http://nas.local/",
  ]) {
    expect(isLocal(url)).toBe(true);
  }
});

test("IPv4 addresses written as IPv6 are blocked in every form", () => {
  // the URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1
  for (const url of [
    "http://[::ffff:127.0.0.1]:8080/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:192.168.1.1]/",
  ]) {
    expect(isLocal(url)).toBe(true);
  }
});

test("IPv6 ranges that reach this device, the network or nowhere are blocked", () => {
  for (const url of [
    "http://[64:ff9b::7f00:1]/", // NAT64 to 127.0.0.1
    "http://[64:ff9b::c0a8:101]/", // NAT64 to 192.168.1.1
    "http://[64:ff9b::a9fe:a9fe]/", // NAT64 to the cloud metadata address
    "http://[64:ff9b:1::1]/", // local-use NAT64
    "http://[2002:7f00:1::1]/", // 6to4 from 127.0.0.1
    "http://[2002:c0a8:101::1]/", // 6to4 from 192.168.1.1
    "http://[100::1]/", // discard
    "http://[2001:db8::1]/", // documentation
    "http://[2001:2::1]/", // benchmarking
    "http://[2001::1]/", // Teredo
    "http://[ff02::1]/", // multicast
    "http://[fec0::1]/", // site-local
    "http://[::]/",
    "http://[::7f00:1]/", // IPv4-compatible
  ]) {
    expect(isLocal(url)).toBe(true);
  }
});

test("addresses as DNS answers them, in any spelling", () => {
  for (const ip of [
    "0:0:0:0:0:0:0:1",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "::1",
    "fe80::1%en0",
    "::ffff:127.0.0.1",
    "64:ff9b::127.0.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "192.0.2.1",
    "not an address",
    "1:2:3",
    "1::2::3",
    "1.2.3",
  ]) {
    expect(isLocalIp(ip)).toBe(true);
  }
  for (const ip of [
    "93.184.216.34",
    "2606:2800:220:1:248:1893:25c8:1946",
    "64:ff9b::5db8:d822", // NAT64 to a public address: an IPv6-only network
    "2002:5db8:d822::1",
  ]) {
    expect(isLocalIp(ip)).toBe(false);
  }
});

test("public sites are allowed", () => {
  for (const url of [
    "https://example.com/",
    "http://8.8.8.8/",
    "https://[2001:4860:4860::8888]/",
  ]) {
    expect(isLocal(url)).toBe(false);
  }
});

test("pages that act when opened are not opened", () => {
  for (const url of [
    "https://example.com/reset-password",
    "https://example.com/unsubscribe?id=1",
    "https://example.com/a?code=123",
    "https://example.com/" + "a".repeat(40),
    "https://user:pass@example.com/",
  ]) {
    expect(canOpenPage(new URL(url))).toBe(false);
  }
  expect(canOpenPage(new URL("https://example.com/blog/hello"))).toBe(true);
});
