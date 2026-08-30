import {describe, expect, it, vi} from "vitest";
import {CodexProcessMonitor} from "../main/codex-process";

describe("CodexProcessMonitor", () => {
  it("notifies only on transitions unless forced", async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({running: false, executablePath: null})
      .mockResolvedValueOnce({running: false, executablePath: null})
      .mockResolvedValueOnce({running: true, executablePath: "C:\\Codex\\Codex.exe"});
    const listener = vi.fn();
    const monitor = new CodexProcessMonitor(listener, inspect);

    await monitor.checkNow(true);
    await monitor.checkNow();
    await monitor.checkNow();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      running: true,
      executablePath: "C:\\Codex\\Codex.exe",
    });
  });
});
