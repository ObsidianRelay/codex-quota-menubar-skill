import {EventEmitter} from "node:events";
import {describe, expect, it, vi} from "vitest";
import {
  type GlobalMouseHook,
  OutsideClickMonitor,
  pointIsInsideBounds,
} from "../main/outside-click-monitor";

class FakeMouseHook extends EventEmitter implements GlobalMouseHook {
  starts = 0;
  stops = 0;

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }
}

const mouseDown = (x: number, y: number) => ({
  type: 7,
  time: Date.now(),
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  x,
  y,
  button: 1,
  clicks: 1,
});

describe("outside click monitoring", () => {
  it("uses inclusive top-left and exclusive bottom-right bounds", () => {
    const bounds = {x: 100, y: 50, width: 470, height: 390};
    expect(pointIsInsideBounds({x: 100, y: 50}, bounds)).toBe(true);
    expect(pointIsInsideBounds({x: 569, y: 439}, bounds)).toBe(true);
    expect(pointIsInsideBounds({x: 570, y: 440}, bounds)).toBe(false);
  });

  it("dismisses only for a mouse press outside the panel", async () => {
    const hook = new FakeMouseHook();
    const onOutside = vi.fn();
    const monitor = new OutsideClickMonitor(
      hook,
      () => ({x: 100, y: 50, width: 470, height: 390}),
      (point) => ({x: point.x / 2, y: point.y / 2}),
      onOutside,
    );

    monitor.start();
    monitor.start();
    hook.emit("mousedown", mouseDown(300, 200));
    hook.emit("mousedown", mouseDown(20, 20));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(hook.starts).toBe(1);
    expect(onOutside).toHaveBeenCalledTimes(1);

    monitor.stop();
    monitor.stop();
    hook.emit("mousedown", mouseDown(20, 20));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(hook.stops).toBe(1);
    expect(onOutside).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the native hook is unavailable", () => {
    const monitor = new OutsideClickMonitor(
      null,
      () => ({x: 0, y: 0, width: 100, height: 100}),
      (point) => point,
      vi.fn(),
    );
    expect(() => {
      monitor.start();
      monitor.stop();
    }).not.toThrow();
  });
});
