import { expect, test } from "bun:test";

import { memoryChannelPair } from "./channel";
import { type Bytes, deriveVaultKeys, fromBase64, toBase64 } from "./crypto";
import { SyncEngine } from "./engine";
import {
  EnrollmentInvites,
  joinTrustedVault,
  parseEnrollmentLink,
} from "./enrollment";
import { Hlc } from "./hlc";
import { Session } from "./session";
import { MemoryStore } from "./testing";
import {
  type DeviceIdentity,
  VaultTrust,
  VaultTrustManager,
} from "./vault-trust";

const primaryId = "a".repeat(32);
const keptId = "b".repeat(32);
const lostId = "c".repeat(32);
const p256 = { name: "ECDSA", namedCurve: "P-256" } as const;

async function signer(deviceId: string): Promise<DeviceIdentity> {
  const pair = await crypto.subtle.generateKey(p256, false, ["sign", "verify"]);
  return {
    deviceId,
    publicKey: toBase64(
      new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    ),
    async sign(message: Bytes) {
      return new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pair.privateKey,
          message,
        ),
      );
    },
  };
}

async function setup() {
  const [primary, kept, lost] = await Promise.all([
    signer(primaryId),
    signer(keptId),
    signer(lostId),
  ]);
  const initial = await VaultTrust.create(primary);
  const paired = await (
    await initial.enroll(primary, kept)
  ).enroll(primary, lost);
  return { primary, kept, lost, initial, paired };
}

test("only the pinned primary can issue updates, and signatures bind the key and list", async () => {
  const { primary, kept, lost, initial, paired } = await setup();
  await expect(paired.rotate(kept)).rejects.toThrow("Only the primary");
  await expect(paired.rotate(primary, primaryId)).rejects.toThrow(
    "cannot be revoked",
  );
  const rotated = await paired.rotate(primary, lostId);
  expect(rotated.generation).toBe(paired.generation + 1);
  expect(rotated.snapshot().vaultKey).not.toBe(paired.snapshot().vaultKey);
  expect(rotated.member(lostId)).toBeUndefined();
  await expect(paired.accept(lost, rotated.snapshot())).rejects.toThrow(
    "not authorized",
  );
  const updated = await paired.accept(kept, rotated.snapshot());
  expect(updated.fingerprint).toBe(rotated.fingerprint);
  await expect(updated.accept(kept, paired.snapshot())).rejects.toThrow(
    "stale",
  );
  await expect(
    initial.accept(primary, {
      ...rotated.snapshot(),
      vaultKey: paired.snapshot().vaultKey,
    }),
  ).rejects.toThrow("could not be verified");
  await expect(
    initial.accept(primary, {
      ...rotated.snapshot(),
      membership: {
        ...rotated.snapshot().membership,
        generation: rotated.generation + 1,
      },
    }),
  ).rejects.toThrow("could not be verified");
  const competing = await paired.rotate(primary);
  await expect(updated.accept(kept, competing.snapshot())).rejects.toThrow(
    "conflicts",
  );
});

test("a forged identity or a legacy shared-key session cannot connect to an upgraded vault", async () => {
  const { primary, kept, paired } = await setup();
  const impostor = await signer(keptId);
  const connect = (other: Parameters<typeof Session.open>[1]) => {
    const pair = memoryChannelPair();
    return Promise.allSettled([
      Session.open(pair.initiator, {
        deviceId: primaryId,
        identity: primary,
        trust: paired,
      }),
      Session.open(pair.responder, other),
    ]);
  };
  const [claimsKept] = await connect({
    deviceId: keptId,
    identity: { ...kept, sign: impostor.sign },
    trust: paired,
  });
  expect(claimsKept).toMatchObject({
    status: "rejected",
    reason: { code: "auth" },
  });
  const [legacy] = await connect({
    deviceId: keptId,
    authKey: (await deriveVaultKeys(fromBase64(paired.snapshot().vaultKey)!))
      .authKey,
  });
  expect(legacy).toMatchObject({
    status: "rejected",
    reason: { code: "version" },
  });
});

test("an old generation can carry only a primary update and its acknowledgement", async () => {
  const { primary, kept, paired } = await setup();
  const rotated = await paired.rotate(primary, lostId);
  const pair = memoryChannelPair();
  const [a, b] = await Promise.all([
    Session.open(pair.initiator, {
      deviceId: primaryId,
      identity: primary,
      trust: rotated,
    }),
    Session.open(pair.responder, {
      deviceId: keptId,
      identity: kept,
      trust: paired,
    }),
  ]);
  try {
    expect(a.trustUpdateDirection).toBe("send");
    expect(b.trustUpdateDirection).toBe("receive");
    expect(b.matchesTrustUpdate(rotated)).toBe(true);
    await expect(
      a.send({ t: "changes", epoch: "e", items: [], upTo: 0, more: false }),
    ).rejects.toMatchObject({ code: "protocol" });
    await expect(
      b.send({ t: "trust-update", update: paired.snapshot() }),
    ).rejects.toMatchObject({ code: "protocol" });
  } finally {
    a.close();
    b.close();
  }
});

test("rotation catches up an offline member, keeps history, and denies the revoked peer", async () => {
  const { primary, kept, lost, paired } = await setup();
  const confirmed: { deviceId: string; generation: number }[] = [];
  let durableGeneration = paired.generation;
  const main = new VaultTrustManager(primary, paired, async () => {});
  const remote = new VaultTrustManager(kept, paired, async (next) => {
    durableGeneration = next.generation;
  });
  const revoked = new VaultTrustManager(lost, paired, async () => {
    throw new Error("A revoked device must not receive any update");
  });
  const engines = [main, remote, revoked].map((trust, i) => {
    const deviceId = trust.identity.deviceId;
    const store = new MemoryStore(deviceId, new Hlc(deviceId), Date.now);
    return {
      store,
      engine: new SyncEngine({
        deviceId,
        name: `Device ${i}`,
        platform: "mac",
        store,
        trust,
        onTrustConfirmed: (deviceId, generation) => {
          expect(durableGeneration).toBe(generation);
          confirmed.push({ deviceId, generation });
        },
      }),
    };
  });
  const [a, b, c] = engines;
  a.store.copy("keep this history");
  const connect = (other: SyncEngine) => {
    const pair = memoryChannelPair();
    return Promise.all([
      a.engine.attach(pair.initiator),
      other.attach(pair.responder),
    ]);
  };
  try {
    expect(await a.engine.discoveryTag()).toBe(await b.engine.discoveryTag());
    const old = connect(c.engine);
    for (let i = 0; i < 100 && c.engine.peers().length === 0; i++)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(c.engine.peers()).toHaveLength(1);
    const rotation = await main.rotate(lostId);
    await old;
    a.store.copy("not for the revoked device");
    a.engine.localChanged();
    expect(await a.engine.discoveryTag()).toBe(await b.engine.discoveryTag());
    const refused = await connect(c.engine);
    expect(refused[0]).toMatchObject({ code: "auth" });
    expect(revoked.current).toBe(paired);
    expect(c.store.liveTexts()).not.toContain("not for the revoked device");
    expect(await connect(b.engine)).toEqual([null, null]);
    expect(remote.current.fingerprint).toBe(rotation.fingerprint);
    expect(confirmed).toContainEqual({
      deviceId: keptId,
      generation: rotation.generation,
    });
    const connection = connect(b.engine);
    try {
      for (let i = 0; i < 100 && b.engine.peers().length === 0; i++)
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      expect(b.engine.peers()).toHaveLength(1);
      for (let i = 0; i < 100 && b.store.liveTexts().length < 2; i++)
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      expect(b.store.liveTexts()).toEqual([
        "keep this history",
        "not for the revoked device",
      ]);
    } finally {
      a.engine.stop();
      b.engine.stop();
      await connection;
    }
  } finally {
    for (const { engine } of engines) engine.stop();
  }
});

test("a failed durable write keeps the previous generation, and another rotation can retry", async () => {
  const { primary, paired } = await setup();
  let fail = true;
  const manager = new VaultTrustManager(primary, paired, async () => {
    if (fail) throw new Error("disk full");
  });
  let paused = 0;
  manager.beforeInstall(() => {
    expect(manager.permits(paired)).toBe(false);
    paused += 1;
  });
  await expect(manager.rotate(lostId)).rejects.toThrow("disk full");
  expect(manager.permits(paired)).toBe(true);
  fail = false;
  const rotated = await manager.rotate(lostId);
  expect(paused).toBe(2);
  expect(rotated.generation).toBe(paired.generation + 1);
});

test("enrollment pins the primary and consumes the QR exactly once after proof", async () => {
  const { primary, kept, lost, initial } = await setup();
  const manager = new VaultTrustManager(primary, initial, async () => {});
  const invites = new EnrollmentInvites();
  const approvals: string[] = [];
  const engine = new SyncEngine({
    deviceId: primaryId,
    name: "Primary",
    platform: "mac",
    store: new MemoryStore(primaryId, new Hlc(primaryId), Date.now),
    trust: manager,
    invites,
    approveEnrollment: async (candidate) => {
      approvals.push(candidate.deviceId);
      return candidate.deviceId === keptId;
    },
  });
  const qr = () =>
    parseEnrollmentLink(invites.create(initial.pin, ["10.0.0.1:6111"]))!;
  const connect = (
    device: DeviceIdentity,
    invite: ReturnType<typeof qr>,
    persist: (trust: VaultTrust) => Promise<void>,
  ) => {
    const pair = memoryChannelPair();
    return Promise.allSettled([
      engine.attach(pair.responder),
      joinTrustedVault(pair.initiator, device, invite, persist),
    ]);
  };
  let durable: VaultTrust | undefined;
  const keep = async (trust: VaultTrust) => {
    durable = trust;
  };
  try {
    const invite = qr();
    expect(invite.addresses).toEqual(["10.0.0.1:6111"]);
    const wrongPin = {
      ...invite,
      pin: {
        vaultId: invite.pin.vaultId,
        primary: { deviceId: primaryId, publicKey: lost.publicKey },
      },
    };
    expect((await connect(kept, wrongPin, keep))[1].status).toBe("rejected");
    expect(approvals).toEqual([]);
    expect(durable).toBeUndefined();
    expect((await connect(kept, invite, keep))[1].status).toBe("fulfilled");
    expect(durable?.fingerprint).toBe(manager.current.fingerprint);
    expect(manager.current.member(keptId)?.publicKey).toBe(kept.publicKey);
    expect(approvals).toEqual([keptId]);
    expect((await connect(lost, invite, keep))[1].status).toBe("rejected");
    expect(approvals).toEqual([keptId]);
    expect((await connect(lost, qr(), keep))[1].status).toBe("rejected");
    expect(approvals).toEqual([keptId, lostId]);
    expect(manager.current.member(lostId)).toBeUndefined();
  } finally {
    engine.stop();
  }
});
