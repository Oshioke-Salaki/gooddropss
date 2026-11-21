"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { AuthModal } from "@/components/AuthModal";
import { useSessionRestore, markSignedIn } from "@/hooks/useSessionRestore";

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

// Set after the first mount in this visit. Each page mounts its own nav, and
// without this every page change hid the account area for a frame while it
// "mounted" again. The first render after a full page load is still false, so
// it matches the server render and hydration stays clean.
let clientMounted = false;

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { login } = useContext(AuthContext);

  // `ready`: the client has mounted and any saved session has finished
  // restoring, so "signed out" really means signed out. Until then the nav shows
  // a placeholder, never a Sign in button for someone about to be signed in.
  const [mounted, setMounted] = useState(() => clientMounted);
  useEffect(() => { clientMounted = true; setMounted(true); }, []);
  const { unsure } = useSessionRestore();
  const ready = mounted && (isConnected || !unsure);

  // Signing out also ends the wallet session (lib/walletSession), so the next
  // person on this browser can't read the last wallet's private records.
  const logout = useCallback(() => {
    markSignedIn(false); // the next load shouldn't wait for a session that's gone
    fetch("/api/session", { method: "DELETE" })
      .catch(() => {})
      .finally(() => window.dispatchEvent(new Event("gd:session-changed")));
    disconnect();
  }, [disconnect]);

  return { ready, authenticated: isConnected, address, login, logout };
}
