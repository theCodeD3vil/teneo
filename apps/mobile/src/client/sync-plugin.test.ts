import { describe, expect, test } from "bun:test";

import { type NativeSyncStatus, toSyncStatus } from "./sync-plugin";

const mac = {
  id: "mac-1",
  name: "Studio",
  platform: "mac",
  lastSeen: 1000,
  connected: false,
  maker: "",
  address: "192.168.1.20:47823",
  firstSeen: 500,
  removedUs: false,
};
const paired: NativeSyncStatus = {
  paired: true,
  running: true,
  problem: null,
  devices: [],
};

describe("toSyncStatus", () => {
  test("not paired shows no devices, whatever else native code says", () => {
    expect(toSyncStatus({ ...paired, paired: false, devices: [mac] })).toEqual({
      state: "not_paired",
      devices: [],
    });
  });

  test("paired and running with nothing connected is looking", () => {
    expect(toSyncStatus({ ...paired, devices: [mac] })).toEqual({
      state: "searching",
      devices: [
        {
          id: "mac-1",
          name: "Studio",
          platform: "Mac",
          lastSeen: 1000,
          connected: false,
          maker: "",
          address: "192.168.1.20",
          firstSeen: 500,
          disconnectedUs: false,
        },
      ],
    });
  });

  test("a connected device makes it connected", () => {
    const status = toSyncStatus({
      ...paired,
      devices: [
        { ...mac, connected: true },
        { ...mac, id: "mac-2" },
      ],
    });
    expect(status.state).toBe("connected");
    expect(status.devices.map((device) => device.connected)).toEqual([
      true,
      false,
    ]);
  });

  test("a problem that stopped sync is an error; one it runs with is a warning", () => {
    const problem = "Teneo can't read its sync key.";
    expect(toSyncStatus({ ...paired, running: false, problem })).toEqual({
      state: "error",
      devices: [],
      errorMessage: problem,
    });
    expect(toSyncStatus({ ...paired, problem })).toEqual({
      state: "searching",
      devices: [],
      errorMessage: problem,
    });
  });

  test("names what native code left unnamed", () => {
    const [device] = toSyncStatus({
      ...paired,
      devices: [{ ...mac, name: "", platform: "" }],
    }).devices;
    expect([device?.name, device?.platform]).toEqual([
      "Unnamed device",
      "Device",
    ]);
  });
});
