import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

export type CodexProcessState = {
  running: boolean;
  executablePath: string | null;
};

export const inspectCodexProcess = async (): Promise<CodexProcessState> => {
  if (process.platform !== "win32") return {running: false, executablePath: null};
  try {
    const {stdout} = await execFileAsync(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq Codex.exe", "/FO", "CSV", "/NH"],
      {windowsHide: true, timeout: 3500},
    );
    const running = /"Codex\.exe"/i.test(stdout);
    if (!running) return {running: false, executablePath: null};

    try {
      const command =
        "Get-CimInstance Win32_Process -Filter \"Name='Codex.exe'\" | " +
        "Select-Object -First 1 -ExpandProperty ExecutablePath";
      const pathResult = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        {windowsHide: true, timeout: 4000},
      );
      const executablePath = pathResult.stdout.trim() || null;
      return {running: true, executablePath};
    } catch {
      return {running: true, executablePath: null};
    }
  } catch {
    return {running: false, executablePath: null};
  }
};

export class CodexProcessMonitor {
  private timer: NodeJS.Timeout | null = null;
  private previous: CodexProcessState = {running: false, executablePath: null};
  private checking = false;

  constructor(
    private readonly listener: (state: CodexProcessState) => void,
    private readonly inspect = inspectCodexProcess,
  ) {}

  async checkNow(forceNotify = false): Promise<CodexProcessState> {
    if (this.checking) return this.previous;
    this.checking = true;
    try {
      const current = await this.inspect();
      const changed =
        current.running !== this.previous.running ||
        current.executablePath !== this.previous.executablePath;
      this.previous = current;
      if (changed || forceNotify) this.listener(current);
      return current;
    } finally {
      this.checking = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.checkNow(true);
    this.timer = setInterval(() => void this.checkNow(), 2000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
