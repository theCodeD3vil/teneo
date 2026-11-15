import { expect, test } from "bun:test";

import {
  LookupReader,
  orderAddresses,
  parseAddressLine,
  parseBrowseLine,
  parseGateway,
  parseTxt,
} from "./dns-sd-output";
import { LineSplitter } from "./lines";

// What dns-sd printed on this Mac, kept as it came
const browse = `Browsing for _teneo-sync._tcp.local
DATE: ---Sat 14 Nov 2026---
17:59:40.847  ...STARTING...
Timestamp     A/R    Flags  if Domain               Service Type         Instance Name
17:59:40.848  Add        3   1 local.               _teneo-sync._tcp.    teneo-spike
17:59:40.848  Add        2  11 local.               _teneo-sync._tcp.    teneo-spike
17:59:41.100  Rmv        0  11 local.               _teneo-sync._tcp.    teneo-spike
17:59:41.200  Add        2  11 local.               _teneo-sync._tcp.    Michael's Mac (2)
17:59:41.300  Add        2  11 local.               _other._tcp.         elsewhere`;

const lookup = `Lookup teneo-spike._teneo-sync._tcp.local
DATE: ---Sat 14 Nov 2026---
17:59:44.858  ...STARTING...
17:59:44.859  teneo-spike._teneo-sync._tcp.local. can be reached at Michaels-MacBook-Air.local.:47999 (interface 11) Flags: 1
 vt=0123456789abcdef dev=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
17:59:44.859  teneo-spike._teneo-sync._tcp.local. can be reached at Michaels-MacBook-Air.local.:47999 (interface 11)
 vt=0123456789abcdef dev=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

const addresses = `Timestamp     A/R  Flags         IF  Hostname                               Address                                      TTL
17:59:48.893  Add  40000003       1  Michaels-MacBook-Air.local.            127.0.0.1                                    4500
17:59:48.893  Add  40000002      11  Michaels-MacBook-Air.local.            10.162.127.112                               4500
17:59:49.000  Rmv  40000002      11  Michaels-MacBook-Air.local.            10.162.127.112                               4500`;

test("browse lines give the instances that appear and go, of our type only", () => {
  const events = browse
    .split("\n")
    .map((line) => parseBrowseLine(line, "_teneo-sync._tcp"))
    .filter((event) => event !== null);
  expect(events).toEqual([
    { added: true, name: "teneo-spike" },
    { added: true, name: "teneo-spike" },
    { added: false, name: "teneo-spike" },
    { added: true, name: "Michael's Mac (2)" }, // a name with spaces stays whole
  ]);
});

// dns-sd pads the hour with a space, so a morning line starts with one
test("lines printed before ten in the morning are read like any other", () => {
  expect(
    parseBrowseLine(
      " 7:48:17.493  Add        2  11 local.               _teneo-sync._tcp.    teneo-7005fa37acb2",
      "_teneo-sync._tcp",
    ),
  ).toEqual({ added: true, name: "teneo-7005fa37acb2" });
  expect(
    parseBrowseLine(
      " 0:00:01.002  Rmv        0  11 local.               _teneo-sync._tcp.    teneo-7005fa37acb2",
      "_teneo-sync._tcp",
    ),
  ).toEqual({ added: false, name: "teneo-7005fa37acb2" });
  expect(
    parseAddressLine(
      " 7:48:37.678  Add  40000002      11  Android_R9E3DGZG.local.                10.103.147.116                               120",
    ),
  ).toBe("10.103.147.116");
});

test("a lookup gives the host, the port and the TXT once it has both", () => {
  const reader = new LookupReader();
  const found = lookup
    .split("\n")
    .map((line) => reader.feed(line))
    .filter((service) => service !== null);
  expect(found).toHaveLength(2);
  expect(found[0]).toEqual({
    host: "Michaels-MacBook-Air.local.",
    port: 47999,
    txt: { vt: "0123456789abcdef", dev: "a".repeat(32) },
  });
});

test("a TXT line before the address line is not taken for one", () => {
  expect(new LookupReader().feed(" vt=1 dev=2")).toBeNull();
});

test("address lines give the addresses a host has, and ignore the rest", () => {
  expect(addresses.split("\n").map(parseAddressLine)).toEqual([
    null, // the header
    "127.0.0.1",
    "10.162.127.112",
    null, // a Rmv
  ]);
});

test("addresses on the network come before this Mac's own, without repeats", () => {
  expect(
    orderAddresses(["127.0.0.1", "10.0.0.2", "10.0.0.2", "192.168.1.9"]),
  ).toEqual(["10.0.0.2", "192.168.1.9", "127.0.0.1"]);
});

test("TXT pairs are read, and a pair with no value or name is not", () => {
  expect(parseTxt(" vt=ab dev=cd junk =x e=")).toEqual({
    vt: "ab",
    dev: "cd",
    e: "",
  });
});

test("the gateway comes from route's output", () => {
  const output = `   route to: default
destination: default
       mask: default
    gateway: 192.168.43.1
  interface: en0`;
  expect(parseGateway(output)).toBe("192.168.43.1");
  expect(
    parseGateway("route: writing to routing socket: not in table"),
  ).toBeNull();
});

test("output that arrives in pieces is cut into whole lines", () => {
  const splitter = new LineSplitter();
  expect(splitter.push("first li")).toEqual([]);
  expect(splitter.push("ne\r\nsecond\nthi")).toEqual(["first line", "second"]);
  expect(splitter.push("rd\n")).toEqual(["third"]);
});
