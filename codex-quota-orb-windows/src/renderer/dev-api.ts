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
  let mode: WindowMode = {isOpen: false, direction: "down"};
  const modeListeners = new Set<(value: WindowMode) => void>();

  return {
    getSnapshot: async () => mockSnapshot,
    refresh: async () => mockSnapshot,
    toggleWindow: () => {
      mode = {...mode, isOpen: !mode.isOpen};
      document.body.classList.toggle("preview-open", mode.isOpen);
      for (const listener of modeListeners) listener(mode);
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
