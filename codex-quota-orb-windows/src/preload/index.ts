import {contextBridge, ipcRenderer} from "electron";
import type {QuotaSnapshot, RendererApi, WindowMode} from "../shared/types";

const api: RendererApi = {
  getSnapshot: () => ipcRenderer.invoke("quota:get") as Promise<QuotaSnapshot>,
  refresh: () => ipcRenderer.invoke("quota:refresh") as Promise<QuotaSnapshot>,
  toggleWindow: () => ipcRenderer.send("window:toggle"),
  notifyWindowPrepared: (stage) => ipcRenderer.send("window:prepared", stage),
  notifyWindowTransitionComplete: (transition) =>
    ipcRenderer.send("window:transition-complete", transition),
  beginDrag: (screenX, screenY) => ipcRenderer.send("window:drag-start", screenX, screenY),
  dragTo: (screenX, screenY) => ipcRenderer.send("window:drag-move", screenX, screenY),
  endDrag: (moved) => ipcRenderer.send("window:drag-end", moved),
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: QuotaSnapshot) => listener(snapshot);
    ipcRenderer.on("quota:snapshot", handler);
    return () => ipcRenderer.removeListener("quota:snapshot", handler);
  },
  onWindowMode: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, mode: WindowMode) => listener(mode);
    ipcRenderer.on("window:mode", handler);
    return () => ipcRenderer.removeListener("window:mode", handler);
  },
};

contextBridge.exposeInMainWorld("codexQuotaOrb", api);
