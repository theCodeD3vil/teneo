// A hybrid logical clock. Stamps keep rising on one device, and once a device
// has seen a stamp, every stamp it makes afterwards is larger. As a string:
// 12 hex digits of milliseconds, 4 of counter, then the device id. Plain string
// comparison orders stamps, and the id means two devices never tie.

const stampPattern = /^[0-9a-f]{12}-[0-9a-f]{4}-[0-9a-f]{32}$/;
const deviceIdPattern = /^[0-9a-f]{32}$/;
const maxCounter = 0xffff;

export const isDeviceId = (value: unknown): value is string =>
  typeof value === "string" && deviceIdPattern.test(value);

export const isStamp = (value: unknown): value is string =>
  typeof value === "string" && stampPattern.test(value);

export class Hlc {
  private wall = 0;
  private counter = 0;
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(deviceId: string, now: () => number = Date.now) {
    if (!isDeviceId(deviceId)) throw new Error("A device id is 32 hex digits");
    this.deviceId = deviceId;
    this.now = now;
  }

  /** The stamp for a change made on this device now. */
  next(): string {
    const wall = Math.max(this.wall, this.now());
    this.counter = wall === this.wall ? this.counter + 1 : 0;
    this.wall = wall;
    if (this.counter > maxCounter) {
      this.wall += 1;
      this.counter = 0;
    }
    return `${this.wall.toString(16).padStart(12, "0")}-${this.counter
      .toString(16)
      .padStart(4, "0")}-${this.deviceId}`;
  }

  /** Learn a stamp made elsewhere, so the next one is larger than it. */
  observe(stamp: string): void {
    if (!isStamp(stamp)) return;
    const seenWall = parseInt(stamp.slice(0, 12), 16);
    const seenCounter = parseInt(stamp.slice(13, 17), 16);
    if (seenWall > this.wall) {
      this.wall = seenWall;
      this.counter = seenCounter;
    } else if (seenWall === this.wall) {
      this.counter = Math.max(this.counter, seenCounter);
    }
  }
}
