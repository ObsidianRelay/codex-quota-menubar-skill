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
      ...motion.collapsedSurfacePrepared(),
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
    expect(motion.collapsedSurfacePrepared()).toEqual([]);
  });

  it("does not shrink native bounds until the collapsed surface is painted", () => {
    const motion = new WindowMotionCoordinator();
    motion.beginOpening();
    motion.surfacePrepared();
    motion.expandedBoundsPrepared();
    motion.openingComplete();
    motion.beginClosing();

    expect(motion.closingComplete()).toEqual(["publish-mode"]);
    expect(motion.phase).toBe("closing-ready");
    expect(motion.isAnimating).toBe(true);
    expect(motion.closingComplete()).toEqual([]);

    expect(motion.collapsedSurfacePrepared()).toEqual([
      "set-collapsed-bounds",
      "publish-mode",
    ]);
    expect(motion.phase).toBe("collapsed");
    expect(motion.collapsedSurfacePrepared()).toEqual([]);
  });

  it("remembers an outside click that happens before opening finishes", () => {
    const motion = new WindowMotionCoordinator();
    motion.beginOpening();
    motion.surfacePrepared();
    motion.expandedBoundsPrepared();

    expect(motion.beginClosing()).toEqual([]);
    expect(motion.phase).toBe("opening");
    expect(motion.openingComplete()).toEqual(["publish-mode"]);
    expect(motion.phase).toBe("closing");
    expect(motion.closingComplete()).toEqual(["publish-mode"]);
    expect(motion.collapsedSurfacePrepared()).toEqual([
      "set-collapsed-bounds",
      "publish-mode",
    ]);
  });
});
