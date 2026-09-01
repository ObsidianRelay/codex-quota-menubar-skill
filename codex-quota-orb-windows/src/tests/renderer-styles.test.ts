import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const styles = readFileSync(
  fileURLToPath(new URL("../renderer/styles.css", import.meta.url)),
  "utf8",
);

describe("orb renderer styles", () => {
  it("uses the fixed 88px orb and its legible font sizes", () => {
    expect(styles).toContain("--orb-size: 88px;");
    expect(styles).toContain("--five-label-size: 8px;");
    expect(styles).toContain("--five-value-size: 13px;");
    expect(styles).not.toContain(".size-small");
    expect(styles).not.toContain(".size-large");
    expect(styles).toContain("text-rendering: auto;");
    expect(styles).not.toContain("text-rendering: geometricPrecision;");
  });

  it("maps the displayed percentage directly to the liquid height", () => {
    expect(styles).toContain("height: var(--liquid-height);");
    expect(styles).not.toContain("calc(var(--liquid-height) + 8px)");
  });

  it("keeps the restored orb visible while native bounds wait for two frames", () => {
    expect(styles).toContain(".phase-collapsed .orb-surface");
    expect(styles).toContain(".phase-closing-ready .orb-surface");
    expect(styles).toContain("transition-duration: 220ms;");
    expect(styles).toContain("transition-duration: 80ms, 90ms;");
    expect(styles).toContain("transition-delay: 110ms;");
  });

  it("keeps the collapsed surface aligned inside the stable panel-sized host", () => {
    expect(styles).toMatch(
      /\.phase-collapsed \.orb-surface,[\s\S]*left: var\(--origin-x\);[\s\S]*width: var\(--orb-size\);/,
    );
  });

  it("uses faster seamless compositor-only liquid waves", () => {
    expect(styles).toContain("width: 200%;");
    expect(styles).toContain("animation: wave-left 7.2s linear infinite;");
    expect(styles).toContain("animation: wave-right 4.8s linear infinite;");
    expect(styles).toContain("translate3d(-50%, 0, 0)");
    expect(styles).not.toMatch(/\.phase-closing-ready \.liquid-wave[\s\S]*animation-play-state:\s*paused/);
  });
});
