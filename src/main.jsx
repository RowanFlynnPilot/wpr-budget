import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { initAnalytics, track } from "./analytics";

initAnalytics();

// Seamless WordPress embeds: when framed, keep the parent page informed of the
// content height so the iframe can match it — no inner scrollbar, no cut-off
// content in any of the three languages. The host page listens for
// {type:"wpr-budget:height"} (snippet in CLAUDE.md). Height is the only thing
// sent to the parent. Analytics counts the embed by its host page's name only.
if (window.parent !== window) {
  let host = "unknown";
  try { host = new URL(document.referrer).hostname || host; } catch (e) { /* no referrer */ }
  track("Embed", { host });
  const report = () => window.parent.postMessage(
    { type: "wpr-budget:height", height: document.documentElement.scrollHeight }, "*");
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener("load", report);
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
