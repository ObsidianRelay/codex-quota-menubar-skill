import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const styles = readFileSync(
  fileURLToPath(new URL("../renderer/styles.css", import.meta.url)),
  "utf8",
);

describe("orb renderer styles", () => {
  it("uses integer, legible 5h font sizes for all three presets", () => {
    expect(styles).toContain("--five-label-size: 10px;");
    expect(styles).toContain("--five-value-size: 16px;");
    expect(styles).toContain("--five-label-size: 8px;");
    expect(styles).toContain("--five-value-size: 13px;");
    expect(styles).toContain("--five-label-size: 12px;");
    expect(styles).toContain("--five-value-size: 20px;");
    expect(styles).toContain("text-rendering: auto;");
    expect(styles).not.toContain("text-rendering: geometricPrecision;");
  });

  it("keeps the restored orb visible while native bounds wait for two frames", () => {
    expect(styles).toContain(".phase-closing-ready .orb-surface");
    expect(styles).toContain("transition-duration: 220ms;");
    expect(styles).toContain("transition-duration: 80ms, 90ms;");
    expect(styles).toContain("transition-delay: 110ms;");
  });

  it("uses faster seamless compositor-only liquid waves", () => {
    expect(styles).toContain("width: 200%;");
    expect(styles).toContain("animation: wave-left 7.2s linear infinite;");
    expect(styles).toContain("animation: wave-right 4.8s linear infinite;");
    expect(styles).toContain("translate3d(-50%, 0, 0)");
    expect(styles).not.toMatch(/\.phase-closing-ready \.liquid-wave[\s\S]*animation-play-state:\s*paused/);
  });
});
