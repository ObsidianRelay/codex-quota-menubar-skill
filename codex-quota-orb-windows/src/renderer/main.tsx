import React from "react";
import ReactDOM from "react-dom/client";
import {App} from "./App";
import {createDevApi} from "./dev-api";
import "./styles.css";

if (!window.codexQuotaOrb) {
  if (!import.meta.env.DEV) throw new Error("安全预加载接口不可用");
  window.codexQuotaOrb = createDevApi();
  document.body.classList.add("browser-preview");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
