import { expect, test } from "bun:test";

import { pairingAddresses } from "./local-address";

const face = (name: string, address: string, internal = false) => ({
  name,
  address,
  internal,
});

test("pairing addresses are the Mac's local IPv4 addresses with the port", () => {
  expect(
    pairingAddresses(
      [face("en0", "192.168.1.20"), face("en1", "10.0.0.7")],
      47823,
    ),
  ).toEqual(["192.168.1.20:47823", "10.0.0.7:47823"]);
});

test("loopback, IPv6, link-local and public addresses are left out", () => {
  expect(
    pairingAddresses(
      [
        face("lo0", "127.0.0.1", true),
        face("en0", "fe80::1"),
        face("en0", "169.254.8.8"),
        face("en2", "203.0.113.5"),
        face("en0", "192.168.1.20"),
      ],
      47823,
    ),
  ).toEqual(["192.168.1.20:47823"]);
});

test("an address on two interfaces is listed once", () => {
  expect(
    pairingAddresses(
      [face("en0", "192.168.1.20"), face("bridge0", "192.168.1.20")],
      47824,
    ),
  ).toEqual(["192.168.1.20:47824"]);
});

test("no interfaces, no addresses", () => {
  expect(pairingAddresses([], 47823)).toEqual([]);
});
