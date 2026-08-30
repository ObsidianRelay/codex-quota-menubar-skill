import {describe, expect, it} from "vitest";
import {WindowMotionCoordinator} from "../main/window-motion";

describe("window motion coordinator", () => {
  it("uses one native bounds change per opening and closing", () => {
    const motion = new WindowMotionCoordinator();
    const commands = [
      ...motion.beginOpening(),
      ...motion.surfacePrepared(),
      ...motion.expandedBoundsPrepared(),
      ...motion.openingComplete(),
      ...motion.beginClosing(),
      ...motion.closingComplete(),
    ];
    expect(commands.filter((command) => command === "set-expanded-bounds")).toHaveLength(1);
    expect(commands.filter((command) => command === "set-collapsed-bounds")).toHaveLength(1);
    expect(motion.phase).toBe("collapsed");
  });

  it("ignores duplicate and out-of-order animation events", () => {
    const motion = new WindowMotionCoordinator();
    expect(motion.expandedBoundsPrepared()).toEqual([]);
    motion.beginOpening();
    expect(motion.surfacePrepared()).toEqual(["set-expanded-bounds"]);
    expect(motion.surfacePrepared()).toEqual([]);
    expect(motion.openingComplete()).toEqual([]);
    motion.expandedBoundsPrepared();
    motion.openingComplete();
    expect(motion.closingComplete()).toEqual([]);
  });
});
