// The release workflow runs this before it builds: a beta version is built as
// Teneo Beta and a full one as Teneo, whatever tinyjs.json said.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { appIdentities, releaseVariant } from "../backend/app-identity.ts";
import { readAppConfig, writeAppIdentity } from "./app-config.ts";

const { version } = readAppConfig();
const variant = releaseVariant(version);
writeAppIdentity(variant);
const { title, id } = appIdentities[variant];
console.log(`${version} builds as ${title} (${id})`);
