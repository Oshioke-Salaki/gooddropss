"use client";
import { Toaster as Sonner } from "sonner";
import { AlertCircle, Check, Info, Loader2 } from "lucide-react";

/**
 * The app's one toast host (mounted once in Providers). Toasts are for short
 * confirmations and passing hiccups; anything the person must act on stays
 * inline next to what failed. Call `toast` from "@/lib/toast".
 *
 * Top centre so a toast never covers a bottom sheet's main button on a phone.
 * Sonner handles the rest: a polite live region for screen readers, pause on
 * hover/focus, swipe to dismiss, and no motion when reduced motion is on.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={{ top: "calc(12px + env(safe-area-inset-top, 0px))" }}
      mobileOffset={{ top: "calc(12px + env(safe-area-inset-top, 0px))", left: 12, right: 12 }}
      visibleToasts={3}
      duration={4500}
      gap={8}
      style={{ zIndex: 6000 }}
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
            "font-sans w-full flex items-center gap-3 rounded-3xl bg-nav-active text-white py-2 pl-2 pr-4 min-h-12 " +
            "shadow-[0px_6px_24px_0px_#00000033]",
          icon:
            "!m-0 w-8 h-8 shrink-0 rounded-full bg-white/10 flex items-center justify-center " +
            "[[data-type=success]_&]:bg-brand [[data-type=error]_&]:bg-danger",
          content: "flex-1 min-w-0 py-1",
          title: "text-sm/[140%]",
          description: "mt-0.5 text-xs/[140%] text-white/70",
          actionButton:
            "shrink-0 h-8 px-3.5 rounded-full bg-white text-heading text-xs/none cursor-pointer hover:bg-white/90",
          cancelButton: "shrink-0 h-8 px-3 rounded-full text-white/70 text-xs/none cursor-pointer hover:text-white",
        },
      }}
    />
  );
}
