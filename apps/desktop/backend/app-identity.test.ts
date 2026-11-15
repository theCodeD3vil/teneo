import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { appIdentities, releaseVariant, withIdentity } from "./app-identity";

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

test("an identity changes the name, the id and the update address only", () => {
  const beta = withIdentity(config, "beta");
  expect(beta).toEqual({
    ...config,
    title: "Teneo Beta",
    id: "com.michael.teneo.beta",
    update: { url: appIdentities.beta.updateUrl, auto: "daily" },
  });
  expect(withIdentity(beta, "production")).toEqual(config);
});

test("keepId renames the app and leaves its data where it is", () => {
  const debug = withIdentity(config, "debug", { keepId: true });
  expect(debug.title).toBe("Teneo Debug");
  expect(debug.id).toBe("com.michael.teneo");
});

test("tinyjs.json is formatted the way the scripts write it back", () => {
  const text = readFileSync(`${import.meta.dir}/../tinyjs.json`, "utf8");
  expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`).toBe(text);
});
