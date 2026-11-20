import { expect, test } from "bun:test";

import {
  buildPairingLink,
  deriveVaultKeys,
  formatRecoveryCode,
  fromBase32,
  fromBase64,
  fromHex,
  importAesKey,
  parsePairingLink,
  parseRecoveryCode,
  randomBytes,
  seal,
  toBase32,
  toBase64,
  toHex,
  unseal,
  utf8,
} from "./crypto";

test("hex and base64 round-trip every length", () => {
  for (let length = 0; length < 60; length++) {
    const bytes = randomBytes(length);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  }
  const big = randomBytes(300_000);
  expect(fromBase64(toBase64(big))).toEqual(big);
});

test("base64 matches the standard encoding and refuses what is not", () => {
  expect(toBase64(utf8("foob"))).toBe("Zm9vYg==");
  expect(toBase64(utf8("fooba"))).toBe("Zm9vYmE=");
  expect(toBase64(utf8("foobar"))).toBe("Zm9vYmFy");
  for (const bad of ["Zm9", "Zm9v!A==", "=Zm9", "Zm9vYg=a"])
    expect(fromBase64(bad)).toBeNull();
  expect(fromHex("abc")).toBeNull();
  expect(fromHex("zz")).toBeNull();
});

test("base32 round-trips and forgives what people mistype", () => {
  const key = randomBytes(32);
  const text = toBase32(key);
  expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]{52}$/);
  expect(fromBase32(text)).toEqual(key);
  expect(fromBase32(text.toLowerCase())).toEqual(key);
  expect(fromBase32(text.replace(/0/g, "O").replace(/1/g, "l"))).toEqual(key);
  expect(fromBase32(text.match(/.{1,4}/g)!.join(" - "))).toEqual(key);
  expect(fromBase32("U")).toBeNull(); // not in the alphabet
});

test("the recovery code is 14 groups of four and round-trips", async () => {
  const key = randomBytes(32);
  const code = await formatRecoveryCode(key);
  expect(code).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  expect(await parseRecoveryCode(code)).toEqual(key);
  expect(
    await parseRecoveryCode(code.toLowerCase().replace(/-/g, " ")),
  ).toEqual(key);
});

test("a recovery code with any one character changed is refused", async () => {
  const key = randomBytes(32);
  const code = await formatRecoveryCode(key);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "-") continue;
    const other = alphabet[(alphabet.indexOf(code[i]!) + 1) % alphabet.length]!;
    expect(
      await parseRecoveryCode(code.slice(0, i) + other + code.slice(i + 1)),
    ).toBeNull();
  }
});

test("a short, long or empty recovery code is refused", async () => {
  const code = await formatRecoveryCode(randomBytes(32));
  expect(await parseRecoveryCode("")).toBeNull();
  expect(await parseRecoveryCode(code.slice(0, -5))).toBeNull();
  expect(await parseRecoveryCode(code + "-AAAA")).toBeNull();
});

test("the pairing link carries a one-time key and the addresses, never the vault's", () => {
  const key = randomBytes(32);
  const link = buildPairingLink(key, ["192.168.1.20:47823", "10.0.0.5:47824"]);
  expect(link).toStartWith("teneo://pair?v=2&p=");
  expect(parsePairingLink(link)).toEqual({
    kind: "pairing",
    pairingKey: key,
    addresses: ["192.168.1.20:47823", "10.0.0.5:47824"],
  });
  expect(parsePairingLink(buildPairingLink(key, []))).toEqual({
    kind: "pairing",
    pairingKey: key,
    addresses: [],
  });
});

test("an older Mac's link, with the vault key in it, still reads", () => {
  const key = randomBytes(32);
  const link = `teneo://pair?v=1&k=${buildPairingLink(key, []).split("p=")[1]!.split("&")[0]}&a=192.168.1.20:47823`;
  expect(parsePairingLink(link)).toEqual({
    kind: "vault",
    vaultKey: key,
    addresses: ["192.168.1.20:47823"],
  });
});

test("a pairing link of another version, or a damaged one, is refused", () => {
  const key = randomBytes(32);
  const link = buildPairingLink(key, ["192.168.1.20:47823"]);
  expect(parsePairingLink(link.replace("v=2", "v=3"))).toBeNull();
  expect(parsePairingLink(link.replace("teneo://", "https://"))).toBeNull();
  expect(parsePairingLink(link.replace(/p=[^&]+/, "p=SHORT"))).toBeNull();
  expect(
    parsePairingLink(link.replace("192.168.1.20:47823", "not an address")),
  ).toBeNull();
  expect(() => buildPairingLink(key, ["no-port"])).toThrow();
});

test("each label derives its own key, the same way every time", async () => {
  const vault = randomBytes(32);
  const keys = await deriveVaultKeys(vault);
  expect(await deriveVaultKeys(vault)).toEqual(keys);
  expect(keys.authKey).not.toEqual(keys.dataKey);
  // the discovery key: 32 bytes, never sent (discovery-record.ts)
  expect(keys.tag).toMatch(/^[0-9a-f]{64}$/);
  const other = await deriveVaultKeys(randomBytes(32));
  expect(other.tag).not.toBe(keys.tag);
  expect(other.authKey).not.toEqual(keys.authKey);
});

test("a sealed frame opens only at its own number, and only unaltered", async () => {
  const key = await importAesKey(randomBytes(32));
  const sealed = await seal(key, 5, utf8("hello"));
  expect(new TextDecoder().decode(await unseal(key, 5, sealed))).toBe("hello");
  await expect(unseal(key, 4, sealed)).rejects.toThrow();
  await expect(unseal(key, 6, sealed)).rejects.toThrow();
  const tampered = sealed.slice();
  tampered[0] = tampered[0]! ^ 1;
  await expect(unseal(key, 5, tampered)).rejects.toThrow();
  // numbers past 32 bits are told apart too
  const far = await seal(key, 2 ** 33 + 1, utf8("far"));
  await expect(unseal(key, 1, far)).rejects.toThrow();
  expect(new TextDecoder().decode(await unseal(key, 2 ** 33 + 1, far))).toBe(
    "far",
  );
});
