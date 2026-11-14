import { expect, test } from "bun:test";

import { canOpenPage, isLocalAddress } from "./link-safety";

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
