import {describe, expect, it} from "vitest";
import {CLOSE_MS, OPEN_RESIZE_MS, OPEN_SETTLE_MS, OPEN_TOTAL_MS} from "../shared/animation";

describe("animation timing", () => {
  it("opens in 0.75 seconds with a dedicated settle phase", () => {
    expect(OPEN_RESIZE_MS).toBe(600);
    expect(OPEN_SETTLE_MS).toBe(150);
    expect(OPEN_TOTAL_MS).toBe(750);
  });

  it("keeps the approved closing duration", () => {
    expect(CLOSE_MS).toBe(1430);
  });
});
