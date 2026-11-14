import { describe, expect, test } from "bun:test";

import {
  formatPids,
  isDnsSdCommand,
  ownerOfPidFile,
  parsePids,
  pidFileName,
} from "./dns-sd-orphans";

describe("pid file names", () => {
  test("a name leads back to its owner", () => {
    expect(ownerOfPidFile(pidFileName(4242))).toBe(4242);
  });

  test("other files are not ours", () => {
    for (const name of [
      "bonjour-.pids",
      "bonjour-12.txt",
      "bonjour-12.pids.bak",
      "bonjour-0.pids",
      "bonjour--5.pids",
      "bonjour-1e3.pids",
      "xbonjour-12.pids",
      "teneo.sqlite",
      "",
    ]) {
      expect(ownerOfPidFile(name)).toBeNull();
    }
  });

  test("an owner too large to be a pid is refused", () => {
    expect(ownerOfPidFile("bonjour-99999999999999999999.pids")).toBeNull();
  });
});

describe("pid lists", () => {
  test("what is written is read back, in order", () => {
    expect(parsePids(formatPids([30, 10, 20]))).toEqual([30, 10, 20]);
    expect(parsePids(formatPids([]))).toEqual([]);
  });

  test("anything that is not a pid is skipped", () => {
    expect(
      parsePids(
        "12\nabc\n\n-3\n0\n4.5\n1e2\n 77 \n12 13\n99999999999999999999\n",
      ),
    ).toEqual([12, 77]);
  });

  test("a pid written twice is read once", () => {
    expect(parsePids("5\n6\n5\n")).toEqual([5, 6]);
  });

  test("a torn last line without a newline still counts", () => {
    expect(parsePids("5\n6")).toEqual([5, 6]);
  });
});

describe("recognising dns-sd", () => {
  test("by its name, bare or with a path", () => {
    expect(
      isDnsSdCommand("dns-sd -R teneo-ab _teneo-sync._tcp local 47823\n"),
    ).toBe(true);
    expect(isDnsSdCommand("/usr/bin/dns-sd -B _teneo-sync._tcp local")).toBe(
      true,
    );
    expect(isDnsSdCommand("  dns-sd  ")).toBe(true);
  });

  test("not by a mention of it", () => {
    expect(isDnsSdCommand("")).toBe(false);
    expect(isDnsSdCommand("\n")).toBe(false);
    expect(isDnsSdCommand("/usr/bin/vim dns-sd")).toBe(false);
    expect(isDnsSdCommand("/bin/sh -c dns-sd -B x")).toBe(false);
    expect(isDnsSdCommand("my-dns-sd -B x")).toBe(false);
    expect(isDnsSdCommand("/Applications/Teneo.app/Contents/MacOS/teneo")).toBe(
      false,
    );
  });
});
