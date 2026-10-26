"use client";
import { useEffect } from "react";

/**
 * Registers the service worker (push notifications + offline fallback).
 *
 * `updateViaCache: "none"` makes the browser revalidate sw.js itself on every
 * check, so a fix to the worker reaches people on their next visit. When a new
 * worker takes over an already-open tab, reload once: the tab was started by
 * the old worker and may be running an old build.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const onChange = () => {
      // First install on a fresh visit also fires this — nothing stale to replace.
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {}); // the app works without it; push just won't

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);
  return null;
}
