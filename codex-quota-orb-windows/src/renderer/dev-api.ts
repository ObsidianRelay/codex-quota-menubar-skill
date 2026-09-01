import type {QuotaSnapshot, RendererApi, WindowMode} from "../shared/types";

const mockSnapshot: QuotaSnapshot = {
  remaining5h: 82,
  remaining7d: 65,
  resetAt7d: new Date(Date.now() + 6 * 24 * 3_600_000 + 16 * 3_600_000).toISOString(),
  checkedAt: new Date().toISOString(),
  planType: "Plus",
  monthlyTokens: 692_900_000,
  dailyUsage: Array.from({length: 31}, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    tokens: [8, 0, 36, 28, 22, 43, 80, 210, 96, 118, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0][index] * 1_000_000,
  })),
  error: null,
};

export const createDevApi = (): RendererApi => {
  let mode: WindowMode = {
    phase: "collapsed",
    direction: "down",
    originX: 358,
    originY: 0,
  };
  const modeListeners = new Set<(value: WindowMode) => void>();
  const publishMode = () => {
    for (const listener of modeListeners) listener(mode);
  };

  return {
    getSnapshot: async () => mockSnapshot,
    refresh: async () => mockSnapshot,
    toggleWindow: () => {
      if (mode.phase === "collapsed") {
        mode = {...mode, phase: "opening-prep"};
        publishMode();
      } else if (mode.phase === "expanded") {
        mode = {...mode, phase: "closing"};
        publishMode();
      }
    },
    notifyWindowPrepared: (stage) => {
      if (mode.phase === "closing-ready" && stage === "collapsed-surface") {
        document.body.classList.remove("preview-open");
        mode = {...mode, phase: "collapsed"};
        publishMode();
        return;
      }
      if (mode.phase !== "opening-prep" || stage !== "expanded-bounds") return;
      document.body.classList.add("preview-open");
      mode = {...mode, phase: "opening"};
      publishMode();
    },
    notifyWindowTransitionComplete: (transition) => {
      if (transition === "opening" && mode.phase === "opening") {
        mode = {...mode, phase: "expanded"};
        publishMode();
      }
      if (transition === "closing" && mode.phase === "closing") {
        mode = {...mode, phase: "closing-ready"};
        publishMode();
      }
    },
    beginDrag: () => {},
    dragTo: () => {},
    endDrag: () => {},
    onSnapshot: () => () => {},
    onWindowMode: (listener) => {
      modeListeners.add(listener);
      return () => modeListeners.delete(listener);
    },
  };
};
