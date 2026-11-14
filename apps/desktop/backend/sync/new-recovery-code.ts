// `bun backend/sync/new-recovery-code.ts`: prints the recovery code of a new,
// random vault. For `bun run sync:check`, and for trying `bun run sync:peer`
// with two peers and no app. It reads nothing from Teneo.
/* oxlint-disable no-console -- a command-line script prints its result */
import { formatRecoveryCode } from "@teneo/sync";

console.log(
  await formatRecoveryCode(crypto.getRandomValues(new Uint8Array(32))),
);
