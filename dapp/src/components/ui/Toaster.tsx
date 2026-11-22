"use client";
import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";
import { AlertCircle, Check, Info, Loader2 } from "lucide-react";

/**
 * The app's one toast host (mounted once in Providers). Toasts are for short
 * confirmations and passing hiccups; anything the person must act on stays
 * inline next to what failed. Call `toast` from "@/lib/toast".
 *
 * Where: on a phone, top centre, so it never covers a bottom sheet's main button.
 * On a big screen, bottom centre: the top is the nav (top centre covered its
 * tabs), the top right is the wallet panel and macOS's own notifications, and
 * the bottom corners hold the map controls, leaving the bottom middle clear.
 *
 * Look: a light card like the rest of the app (white, hairline, soft shadow),
 * with the meaning carried by a small coloured icon, not a dark slab.
 *
 * Sonner handles the rest: a polite live region for screen readers, pause on
 * hover/focus, swipe to dismiss, and no motion when reduced motion is on.
 */
export function Toaster() {
  const wide = useWide();
  return (
    <Sonner
      position={wide ? "bottom-center" : "top-center"}
      offset={wide ? { bottom: 28 } : { top: "calc(12px + env(safe-area-inset-top, 0px))" }}
      mobileOffset={{ top: "calc(12px + env(safe-area-inset-top, 0px))", left: 12, right: 12 }}
      visibleToasts={3}
      duration={4500}
      gap={8}
      style={{ zIndex: 6000, ["--width" as string]: "380px" }}
      icons={{
        success: <Check className="w-4 h-4" strokeWidth={2.25} />,
        error: <AlertCircle className="w-4 h-4" strokeWidth={2} />,
        info: <Info className="w-4 h-4" strokeWidth={2} />,
        warning: <AlertCircle className="w-4 h-4" strokeWidth={2} />,
        loading: <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "font-sans w-full flex items-center gap-3 " +
            "rounded-2xl bg-white text-heading border border-line py-2.5 pl-2.5 pr-4 min-h-14 " +
            "shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_32px_-8px_rgba(16,24,40,0.18)]",
          icon:
            "!m-0 w-8 h-8 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center " +
            "[[data-type=success]_&]:bg-brand [[data-type=success]_&]:text-white " +
            "[[data-type=error]_&]:bg-[#FFF1F1] [[data-type=error]_&]:text-[#C81E1E]",
          content: "flex-1 min-w-0 py-0.5",
          title: "text-sm/[140%] text-heading",
          description: "mt-0.5 text-xs/[140%] text-nav-muted",
          actionButton:
            "shrink-0 h-8 px-3.5 rounded-full bg-nav-active text-white text-xs/none cursor-pointer hover:opacity-90",
          cancelButton: "shrink-0 h-8 px-3 rounded-full text-nav-muted text-xs/none cursor-pointer hover:text-heading",
        },
      }}
    />
  );
}

/** Big screen (lg and up), tracked live so rotating a tablet moves toasts too. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
