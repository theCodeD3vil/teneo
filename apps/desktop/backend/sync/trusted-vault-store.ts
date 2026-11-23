import {
  type DeviceIdentity,
  type VaultPin,
  VaultTrust,
  VaultTrustManager,
} from "@teneo/sync";

import { devName } from "../dev-run";
import { readKeychain } from "../keychain";

/** The one Keychain item is both the trusted-mode marker and its contents.
 *  Read errors or unreadable contents are fatal; never fall back to legacy. */
const account = () => devName("sync-trusted-vault-v1");

export class TrustedVaultStore {
  private readonly app: TinyApp;

  constructor(app: TinyApp) {
    this.app = app;
  }

  async has(): Promise<boolean> {
    return (await this.app.secrets.get(account())) !== null;
  }

  async read(
    openIdentity: () => Promise<DeviceIdentity>,
    interactive = true,
  ): Promise<VaultTrustManager | null> {
    const encoded = await readKeychain(this.app, account(), interactive);
    if (encoded === null || encoded === undefined) return null;
    const { pin, update } = JSON.parse(encoded) as {
      pin: VaultPin;
      update: unknown;
    };
    const identity = await openIdentity();
    const trust = await VaultTrust.load(pin, identity, update);
    return this.manager(identity, trust);
  }

  async install(
    identity: DeviceIdentity,
    trust: VaultTrust,
  ): Promise<VaultTrustManager> {
    await this.write(trust);
    return this.manager(identity, trust);
  }

  async clear(): Promise<void> {
    if (!(await this.app.secrets.delete(account())))
      throw new Error("Teneo couldn't forget this vault from Keychain");
  }

  private manager(
    identity: DeviceIdentity,
    trust: VaultTrust,
  ): VaultTrustManager {
    return new VaultTrustManager(identity, trust, (next) => this.write(next));
  }

  private async write(trust: VaultTrust): Promise<void> {
    if (
      !(await this.app.secrets.set(
        account(),
        JSON.stringify({ pin: trust.pin, update: trust.snapshot() }),
      ))
    )
      throw new Error("Teneo couldn't save the trusted vault in Keychain");
  }
}
