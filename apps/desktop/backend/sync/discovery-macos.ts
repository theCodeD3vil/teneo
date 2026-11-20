// Bonjour through macOS's own `dns-sd`, run as child processes: -R announces
// this device, -B watches for others, -L finds where one can be reached and
// -G v4 gives its address. Teneo has no Bonjour binding, and a child per job is
// short and easy to end: every one of them is killed on stop.
import {
  type DiscoveryRecord,
  makeDiscoveryRecord,
  readDiscoveryRecord,
} from "@teneo/sync";

import type {
  DiscoveredDevice,
  Discovery,
  DiscoveryOptions,
} from "./discovery";
import {
  LookupReader,
  orderAddresses,
  parseAddressLine,
  parseBrowseLine,
  parseGateway,
} from "./dns-sd-output";
import type { ChildRegistry } from "./dns-sd-registry";
import { LineSplitter } from "./lines";

export const serviceType = "_teneo-sync._tcp";

// dns-sd that ends by itself (the system's mDNS service restarted) is started
// again after this
const restartAfterMs = 5000;
const resolveAttempts = 3;
const resolveTimeoutMs = 4000;
// the addresses of a host arrive one after another: wait this long for more
const moreAddressesMs = 400;

type Child = ReturnType<typeof tjs.spawn>;

interface Job {
  /** Ends the child. */
  stop(): void;
  /** Settles when the child is gone. */
  exited: Promise<void>;
}

export class MacDiscovery implements Discovery {
  private options: DiscoveryOptions | null = null;
  private readonly children = new Set<Child>();
  // browse sees an instance once for each network interface it is on
  private readonly handled = new Set<string>();
  // bumped by every start, restart and stop, so work of an earlier one is let go
  private generation = 0;
  // where the children are noted, so a Teneo that is killed outright doesn't
  // leave them running for good
  private readonly registry: ChildRegistry | null;

  constructor(options: { registry?: ChildRegistry } = {}) {
    this.registry = options.registry ?? null;
  }

  start(options: DiscoveryOptions): void {
    this.options = options;
    // the children of an earlier Teneo that was killed outright
    void this.registry
      ?.reapLeftovers()
      .catch((error) => options.onError?.(error));
    this.begin();
  }

  restart(): void {
    if (!this.options) return;
    this.endChildren();
    this.begin();
  }

  stop(): void {
    this.options = null;
    this.endChildren();
  }

  async defaultGateway(): Promise<string | null> {
    try {
      const child = tjs.spawn(["/sbin/route", "-n", "get", "default"], {
        stdout: "pipe",
        stderr: "ignore",
        stdin: "ignore",
      });
      const output = await child.stdout!.text();
      await child.wait();
      return parseGateway(output);
    } catch {
      return null;
    }
  }

  // --- the jobs

  private begin(): void {
    const options = this.options;
    if (!options) return;
    const generation = ++this.generation;
    this.handled.clear();
    // a new salt for every start: on a new network the announcement is new
    void makeDiscoveryRecord(options.tag, options.deviceId).then(
      (record) => {
        if (generation !== this.generation) return;
        if (options.port !== null) this.announce(record, options.port);
        this.browse(options, record);
      },
      (error: unknown) => options.onError?.(error),
    );
  }

  private endChildren(): void {
    this.generation += 1;
    for (const child of this.children) kill(child);
    this.children.clear();
  }

  /** The instance name and TXT are salted (discovery-record.ts): unique,
   *  and saying nothing about the Mac, its owner or its vault. */
  private announce(record: DiscoveryRecord, port: number): void {
    const generation = this.generation;
    const job = this.spawn(
      [
        "-R",
        record.instance,
        serviceType,
        "local",
        String(port),
        `s=${record.txt.s}`,
        `vt=${record.txt.vt}`,
        `dev=${record.txt.dev}`,
      ],
      () => {},
    );
    this.keepRunning(job, generation, () => this.announce(record, port));
  }

  private browse(options: DiscoveryOptions, record: DiscoveryRecord): void {
    const generation = this.generation;
    const own = record.instance;
    const splitter = new LineSplitter();
    const job = this.spawn(["-B", serviceType, "local"], (chunk) => {
      for (const line of splitter.push(chunk)) {
        const event = parseBrowseLine(line, serviceType);
        if (!event || event.name === own) continue;
        if (!event.added) {
          this.handled.delete(event.name); // it may come back, at another address
        } else if (!this.handled.has(event.name)) {
          this.handled.add(event.name);
          void this.resolve(options, event.name, generation);
        }
      }
    });
    this.keepRunning(job, generation, () => this.browse(options, record));
  }

  /** Where the instance can be reached, and its TXT: if it is a device of this
   *  vault, other than this one, tell the transport. */
  private async resolve(
    options: DiscoveryOptions,
    name: string,
    generation: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < resolveAttempts; attempt++) {
      if (generation !== this.generation) return;
      try {
        const device = await this.lookUp(options, name);
        if (generation !== this.generation) return;
        if (device === "foreign") return; // another vault's: not ours, not again
        if (device) return options.onDevice(device);
      } catch (error) {
        options.onError?.(error);
      }
    }
    this.handled.delete(name); // looked for in vain: the next Add tries again
  }

  /** The device, "foreign" for a service that is not of this vault, or null. */
  private async lookUp(
    options: DiscoveryOptions,
    name: string,
  ): Promise<DiscoveredDevice | "foreign" | null> {
    const reader = new LookupReader();
    const service = await this.readFirst(
      ["-L", name, serviceType, "local"],
      (line) => reader.feed(line),
    );
    if (!service) return null;
    const dev = await readDiscoveryRecord(options.tag, service.txt);
    if (dev === null) return "foreign";
    if (dev === options.deviceId) return "foreign"; // this device
    const addresses = await this.readAddresses(service.host);
    return addresses.length > 0
      ? { deviceId: dev, addresses, port: service.port }
      : null;
  }

  private async readAddresses(host: string): Promise<string[]> {
    const found: string[] = [];
    const splitter = new LineSplitter();
    let more: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((resolve) => {
      const job = this.spawn(["-G", "v4", host], (chunk) => {
        for (const line of splitter.push(chunk)) {
          const address = parseAddressLine(line);
          if (address) found.push(address);
        }
        // the rest of a host's addresses follows the first within moments
        if (found.length > 0 && more === undefined) {
          more = setTimeout(() => job.stop(), moreAddressesMs);
        }
      });
      const limit = setTimeout(() => job.stop(), resolveTimeoutMs);
      void job.exited.then(() => {
        clearTimeout(limit);
        clearTimeout(more);
        resolve();
      });
    });
    return orderAddresses(found);
  }

  /** Run a dns-sd until `read` finds what it is looking for, or it takes too long. */
  private async readFirst<T>(
    args: string[],
    read: (line: string) => T | null,
  ): Promise<T | null> {
    let result: T | null = null;
    const splitter = new LineSplitter();
    await new Promise<void>((resolve) => {
      const job = this.spawn(args, (chunk) => {
        for (const line of splitter.push(chunk)) {
          result ??= read(line);
        }
        if (result !== null) job.stop();
      });
      const limit = setTimeout(() => job.stop(), resolveTimeoutMs);
      void job.exited.then(() => {
        clearTimeout(limit);
        resolve();
      });
    });
    return result;
  }

  /** Start `dns-sd` and hand its output, as it comes, to `onText`. */
  private spawn(args: string[], onText: (text: string) => void): Job {
    const child = tjs.spawn(["dns-sd", ...args], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    this.children.add(child);
    this.registry?.add(child.pid);
    const decoder = new TextDecoder();
    const reader = child.stdout!.getReader();
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          onText(decoder.decode(value, { stream: true }));
        }
      } catch {
        // the child was killed under the read
      }
    })();
    const exited = Promise.all([child.wait(), pump]).then(() => {
      this.children.delete(child);
      this.registry?.remove(child.pid);
    });
    return { stop: () => kill(child), exited };
  }

  /** A job that should run as long as discovery does: if it ends by itself,
   *  start it again, unless discovery was stopped or restarted meanwhile. */
  private keepRunning(job: Job, generation: number, again: () => void): void {
    void job.exited.then(() => {
      if (generation !== this.generation) return;
      setTimeout(() => {
        if (generation === this.generation) again();
      }, restartAfterMs);
    });
  }
}

function kill(child: Child): void {
  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
}
