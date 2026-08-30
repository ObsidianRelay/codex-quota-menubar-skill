import {mkdtemp, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {SettingsStore} from "../main/settings";

describe("settings migration", () => {
  it("uses medium size for an existing settings file without a size field", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-orb-settings-"));
    await writeFile(
      path.join(directory, "settings.json"),
      JSON.stringify({initialized: true, orbCenter: {x: 300, y: 220}}),
      "utf8",
    );
    const settings = new SettingsStore(directory);
    expect(await settings.load()).toEqual({
      initialized: true,
      orbCenter: {x: 300, y: 220},
      orbSizePreset: "medium",
    });
  });

  it("preserves a valid selected size", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-orb-settings-"));
    await writeFile(
      path.join(directory, "settings.json"),
      JSON.stringify({initialized: true, orbCenter: null, orbSizePreset: "large"}),
      "utf8",
    );
    const settings = new SettingsStore(directory);
    expect((await settings.load()).orbSizePreset).toBe("large");
  });
});
