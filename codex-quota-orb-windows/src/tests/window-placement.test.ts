import {describe, expect, it} from "vitest";
import {
  chooseExpansionDirection,
  expandedBoundsForCenter,
  interpolateBounds,
  snapOrbCenter,
} from "../main/window-placement";

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
    expect(snapOrbCenter({x: 1900, y: 500}, workArea)).toEqual({x: 1852, y: 500});
    expect(snapOrbCenter({x: -20, y: -20}, workArea)).toEqual({x: 68, y: 68});
  });

  it("interpolates width and height through one shared progress value", () => {
    const from = {x: 100, y: 100, width: 112, height: 112};
    const to = {x: 100, y: 100, width: 470, height: 390};
    const middle = interpolateBounds(from, to, 0.5);
    expect(middle.width).toBeGreaterThan(112);
    expect(middle.height).toBeGreaterThan(112);
    expect(interpolateBounds(from, to, 1)).toEqual(to);
  });
});
