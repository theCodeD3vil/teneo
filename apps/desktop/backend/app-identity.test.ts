import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
  appIdentities,
  menuBarIcon,
  releaseVariant,
  withIdentity,
} from "./app-identity";

const config = {
  name: "teneo",
  title: "Teneo",
  id: "com.michael.teneo",
  version: "0.4.0",
  update: { url: appIdentities.production.updateUrl, auto: "daily" },
};

test("a beta version is released as Teneo Beta, a full one as Teneo", () => {
  expect(releaseVariant("0.4.0-beta.2")).toBe("beta");
  expect(releaseVariant("0.4.0")).toBe("production");
});

test("the three apps have three names, ids and two update addresses", () => {
  const ids = Object.values(appIdentities).map((identity) => identity.id);
  const titles = Object.values(appIdentities).map((identity) => identity.title);
  expect(new Set(ids).size).toBe(3);
  expect(new Set(titles).size).toBe(3);
  expect(appIdentities.beta.updateUrl).not.toBe(
    appIdentities.production.updateUrl,
  );
});

test("an identity changes the name, the id, the icon and the update address only", () => {
  const beta = withIdentity(config, "beta");
  expect(beta).toEqual({
    ...config,
    title: "Teneo Beta",
    id: "com.michael.teneo.beta",
    icon: "icon-beta.png",
    update: { url: appIdentities.beta.updateUrl, auto: "daily" },
  });
  expect(withIdentity(beta, "production")).toEqual(config);
});

test("keepId renames the app and leaves its data where it is", () => {
  const debug = withIdentity(config, "debug", { keepId: true });
  expect(debug.title).toBe("Teneo Debug");
  expect(debug.id).toBe("com.michael.teneo");
});

test("each app's icon is a file beside tinyjs.json; the full release takes icon.png", () => {
  expect(appIdentities.production.icon).toBeUndefined();
  expect(existsSync(`${import.meta.dir}/../icon.png`)).toBe(true);
  for (const variant of ["beta", "debug"] as const) {
    const icon = appIdentities[variant].icon;
    expect(icon && existsSync(`${import.meta.dir}/../${icon}`)).toBe(true);
  }
});

test("tinyjs.json is formatted the way the scripts write it back", () => {
  const text = readFileSync(`${import.meta.dir}/../tinyjs.json`, "utf8");
  expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`).toBe(text);
});

test("production, beta and debug have distinct bundled menu bar assets", () => {
  const { production, beta, debug } = appIdentities;
  const expected = [
    [production.id, false, "tray.png"],
    [beta.id, false, "tray-beta.png"],
    [debug.id, false, "tray-debug.png"],
    [production.id, true, "tray-debug.png"],
    [beta.id, true, "tray-debug.png"],
  ] as const;
  for (const [id, dev, asset] of expected) {
    expect(menuBarIcon(id, dev)).toBe(asset);
    expect(existsSync(`${import.meta.dir}/../resources/${asset}`)).toBe(true);
  }
});
