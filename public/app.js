import { bootPmApp } from "./lib/controller.js";

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => bootPmApp(document), { once: true });
} else {
  bootPmApp(document);
}
