import {describe, expect, it} from "vitest";
import {
  chooseExpansionDirection,
  collapsedBoundsForCenter,
  expandedBoundsForCenter,
  snapOrbCenter,
} from "../main/window-placement";
import {ORB_SIZE} from "../shared/types";

const workArea = {x: 0, y: 0, width: 1920, height: 1040};

describe("window placement", () => {
  it("expands down and left from the upper-right corner", () => {
    const orb = {x: 1852, y: 68};
    const direction = chooseExpansionDirection(orb, workArea);
    expect(direction).toBe("down");
    const bounds = expandedBoundsForCenter(orb, direction, workArea);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
  });

  it("snaps to the nearest edge and stays visible", () => {
    expect(snapOrbCenter({x: 1900, y: 500}, workArea)).toEqual({x: 1864, y: 500});
    expect(snapOrbCenter({x: -20, y: -20}, workArea)).toEqual({x: 56, y: 56});
  });

  it("keeps the fixed-size orb anchored across the one-step native resize", () => {
    const orb = {x: 1852, y: 68};
    const direction = chooseExpansionDirection(orb, workArea);
    const collapsed = collapsedBoundsForCenter(orb);
    const expanded = expandedBoundsForCenter(orb, direction, workArea);
    const originX = collapsed.x - expanded.x;
    const originY = collapsed.y - expanded.y;
    expect(expanded.x + originX).toBe(collapsed.x);
    expect(expanded.y + originY).toBe(collapsed.y);
    expect(collapsed.width).toBe(ORB_SIZE);
  });

  it("chooses all four expansion directions near their opposite edges", () => {
    expect(chooseExpansionDirection({x: 960, y: 68}, workArea)).toBe("down");
    expect(chooseExpansionDirection({x: 960, y: 972}, workArea)).toBe("up");
    expect(chooseExpansionDirection({x: 68, y: 520}, workArea)).toBe("right");
    expect(chooseExpansionDirection({x: 1852, y: 520}, workArea)).toBe("left");
  });
});
