"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { AuthModal } from "@/components/AuthModal";

// Drop-in replacement for the parts of Privy the app used ({ ready, authenticated,
// login, logout }). Auth state now comes entirely from wagmi — a single source of
// truth — with Magic + injected as the underlying connectors.

interface AuthContextValue {
  login: () => void;
}
const AuthContext = createContext<AuthContextValue>({ login: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const login = useCallback(() => setOpen(true), []);
  return (
    <AuthContext.Provider value={{ login }}>
      {children}
      <AuthModal open={open} onClose={() => setOpen(false)} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const { address, isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { login } = useContext(AuthContext);

  // `ready` mirrors Privy's readiness gate: true once the client has mounted and
  // wagmi has settled its auto-reconnect. A 2s fallback guarantees `ready` can
  // never hang if a connector's reconnect probe stalls — otherwise the Connect
  // button (gated on `ready`) would never appear.
  const [mounted, setMounted]   = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setMounted(true);
    const t = setTimeout(() => setTimedOut(true), 2000);
    return () => clearTimeout(t);
  }, []);
  const settled = status !== "connecting" && status !== "reconnecting";
  const ready = mounted && (settled || timedOut);

  const logout = useCallback(() => disconnect(), [disconnect]);

  return { ready, authenticated: isConnected, address, login, logout };
}
