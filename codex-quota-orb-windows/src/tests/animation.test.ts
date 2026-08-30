import {describe, expect, it} from "vitest";
import {CLOSE_MS, OPEN_MS} from "../shared/animation";

describe("animation timing", () => {
  it("uses the approved fast opening duration", () => {
    expect(OPEN_MS).toBe(320);
  });

  it("uses the approved fast closing duration", () => {
    expect(CLOSE_MS).toBe(260);
  });
});
