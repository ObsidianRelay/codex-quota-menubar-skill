import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {emptySnapshot, type QuotaSnapshot} from "../shared/types";
import {findCodexAppServerCandidates} from "./codex-locator";
import {parseQuotaResponses} from "./quota-parser";

type QueryResult = {
  rateResponse: unknown | null;
  usageResponse: unknown | null;
  error: string | null;
};

const sendJson = (child: ChildProcessWithoutNullStreams, value: unknown) => {
  child.stdin.write(`${JSON.stringify(value)}\n`);
};

const queryCandidate = (binaryPath: string, timeoutMs: number): Promise<QueryResult> =>
  new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(binaryPath, ["app-server", "--listen", "stdio://"], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({rateResponse: null, usageResponse: null, error: String(error)});
      return;
    }

    let settled = false;
    let buffer = "";
    let rateResponse: unknown | null = null;
    let usageResponse: unknown | null = null;
    let lastError = "Codex App Server 没有返回额度数据";
    let timeout: NodeJS.Timeout | null = null;
    let rateGraceTimer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (rateGraceTimer) clearTimeout(rateGraceTimer);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      if (!child.killed) child.kill();
      resolve({rateResponse, usageResponse, error: rateResponse ? null : lastError});
    };

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.id === 2 || message.rateLimits || message.rateLimitsByLimitId) {
          rateResponse = message;
          if (!usageResponse && !rateGraceTimer) rateGraceTimer = setTimeout(finish, 800);
        }
        if (message.id === 3 || message.dailyUsageBuckets) usageResponse = message;
        if (rateResponse && usageResponse) finish();
      } catch {
        // App Server 可能输出非 JSON 诊断行；忽略并继续等待有效响应。
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const trimmed = chunk.trim();
      if (trimmed) lastError = trimmed.slice(0, 240);
    });
    child.on("error", (error) => {
      lastError = error.message;
      finish();
    });
    child.on("exit", () => {
      if (buffer.trim()) consumeLine(buffer);
      finish();
    });
    child.on("spawn", () => {
      sendJson(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "codex-quota-orb",
            version: "0.1.0",
            title: "Codex Quota Orb",
          },
          capabilities: {experimentalApi: true},
        },
      });
      sendJson(child, {jsonrpc: "2.0", method: "initialized", params: null});
      sendJson(child, {jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: null});
      sendJson(child, {jsonrpc: "2.0", id: 3, method: "account/usage/read", params: null});
    });

    timeout = setTimeout(finish, timeoutMs);
  });

export class CodexQuotaReader {
  async read(desktopExecutable: string | null): Promise<QuotaSnapshot> {
    const checkedAt = new Date();
    const candidates = await findCodexAppServerCandidates(desktopExecutable);
    if (candidates.length === 0) return emptySnapshot("没有找到 Codex App Server");

    const deadline = Date.now() + 10_000;
    let lastError = "暂时无法读取";
    let bestPartial: QuotaSnapshot | null = null;
    for (const candidate of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await queryCandidate(candidate, Math.min(4000, remaining));
      if (!result.rateResponse) {
        if (result.error) lastError = result.error;
        continue;
      }
      const response = result.rateResponse as Record<string, unknown>;
      if (response.error && typeof response.error === "object") {
        const message = (response.error as Record<string, unknown>).message;
        lastError = typeof message === "string" ? message : "Codex App Server 返回错误";
        continue;
      }
      const snapshot = parseQuotaResponses(result.rateResponse, result.usageResponse, checkedAt);
      if (snapshot.remaining7d !== null) return snapshot;
      if (snapshot.remaining5h !== null) bestPartial = snapshot;
      lastError = snapshot.error ?? lastError;
    }
    if (bestPartial) {
      bestPartial.error = lastError;
      return bestPartial;
    }
    const failed = emptySnapshot(lastError);
    failed.checkedAt = checkedAt.toISOString();
    return failed;
  }
}
