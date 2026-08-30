import type {RendererApi} from "../shared/types";

declare global {
  interface Window {
    codexQuotaOrb: RendererApi;
  }
}

export {};
