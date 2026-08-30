import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_ORB_SIZE_PRESET,
  type OrbPoint,
  type OrbSizePreset,
} from "../shared/types";

export type StoredSettings = {
  initialized: boolean;
  orbCenter: OrbPoint | null;
  orbSizePreset: OrbSizePreset;
};

const defaults: StoredSettings = {
  initialized: false,
  orbCenter: null,
  orbSizePreset: DEFAULT_ORB_SIZE_PRESET,
};

const isOrbSizePreset = (value: unknown): value is OrbSizePreset =>
  value === "small" || value === "medium" || value === "large";

export class SettingsStore {
  private value: StoredSettings = {...defaults};
  private readonly filePath: string;

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "settings.json");
  }

  async load(): Promise<StoredSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredSettings>;
      this.value = {
        initialized: parsed.initialized === true,
        orbCenter:
          parsed.orbCenter &&
          Number.isFinite(parsed.orbCenter.x) &&
          Number.isFinite(parsed.orbCenter.y)
            ? parsed.orbCenter
            : null,
        orbSizePreset: isOrbSizePreset(parsed.orbSizePreset)
          ? parsed.orbSizePreset
          : DEFAULT_ORB_SIZE_PRESET,
      };
    } catch {
      this.value = {...defaults};
    }
    return this.get();
  }

  get(): StoredSettings {
    return JSON.parse(JSON.stringify(this.value)) as StoredSettings;
  }

  async update(patch: Partial<StoredSettings>): Promise<void> {
    this.value = {...this.value, ...patch};
    await mkdir(path.dirname(this.filePath), {recursive: true});
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), "utf8");
    await rename(temporary, this.filePath);
  }
}
