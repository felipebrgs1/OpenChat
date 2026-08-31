import type { MeResponse, PublicUser, TokenResponse } from "@nexo/contracts";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "./api";
import { authDisabled } from "./flags";
import { clearSession, getSession, setSession } from "./session";

type AuthContextValue = {
  ready: boolean;
  user: PublicUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  acceptInvite: (token: string, name: string, password: string) => Promise<void>;
  refreshMe: () => Promise<MeResponse | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(getSession()?.user ?? null);

  const applyTokens = (tokens: TokenResponse) => {
    setSession(tokens);
    setUser(tokens.user);
  };

  const refreshMe = async () => {
    if (!getSession()?.accessToken && !authDisabled()) {
      setUser(null);
      return null;
    }
    try {
      const me = await api<MeResponse>("/api/me");
      const session = getSession();
      if (session) {
        setSession({ ...session, user: me.user });
      }
      setUser(me.user);
      return me;
    } catch {
      clearSession();
      setUser(null);
      return null;
    }
  };

  useEffect(() => {
    void (async () => {
      if (getSession()?.accessToken || authDisabled()) {
        await refreshMe();
      }
      setReady(true);
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      async login(email, password) {
        const tokens = await api<TokenResponse>("/api/auth/login", {
          method: "POST",
          skipAuth: true,
          body: JSON.stringify({ email, password }),
        });
        applyTokens(tokens);
      },
      async logout() {
        const session = getSession();
        try {
          await api("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({ refreshToken: session?.refreshToken }),
          });
        } catch {
          // local logout still happens
        }
        clearSession();
        setUser(null);
      },
      async acceptInvite(token, name, password) {
        const tokens = await api<TokenResponse>(`/api/invites/${token}/accept`, {
          method: "POST",
          skipAuth: true,
          body: JSON.stringify({ name, password }),
        });
        applyTokens(tokens);
      },
      refreshMe,
    }),
    [ready, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth fora do AuthProvider");
  }
  return ctx;
}
