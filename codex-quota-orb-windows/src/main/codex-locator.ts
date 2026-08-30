import {constants as fsConstants} from "node:fs";
import {access, readdir} from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

const canReadFile = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const searchNearby = async (desktopExecutable: string | null): Promise<string[]> => {
  if (!desktopExecutable) return [];
  const root = path.dirname(desktopExecutable);
  const matches: string[] = [];
  let visited = 0;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 3 || visited >= 400) return;
    let entries;
    try {
      entries = await readdir(directory, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited++ >= 400) return;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase() === "codex.exe" &&
        path.resolve(fullPath).toLowerCase() !== path.resolve(desktopExecutable).toLowerCase()
      ) {
        matches.push(fullPath);
      }
    }
  };

  await walk(root, 0);
  return matches.sort((a, b) => {
    const score = (value: string) =>
      Number(value.includes(".plugin-appserver")) * 4 +
      Number(value.toLowerCase().includes("resources")) * 2;
    return score(b) - score(a);
  });
};

const whereCodex = async (): Promise<string[]> => {
  if (process.platform !== "win32") return [];
  try {
    const {stdout} = await execFileAsync("where.exe", ["codex"], {
      windowsHide: true,
      timeout: 3000,
    });
    return stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const findCodexAppServerCandidates = async (
  desktopExecutable: string | null,
): Promise<string[]> => {
  const userProfile = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const candidates = [
    process.env.CODEX_QUOTA_APP_SERVER_PATH ?? "",
    userProfile
      ? path.join(userProfile, ".codex", "plugins", ".plugin-appserver", "codex.exe")
      : "",
    ...(await whereCodex()),
    ...(await searchNearby(desktopExecutable)),
  ].filter(Boolean);

  const unique = [...new Set(candidates.map((value) => path.resolve(value)))];
  const available: string[] = [];
  for (const candidate of unique) {
    if (await canReadFile(candidate)) available.push(candidate);
  }
  return available;
};
