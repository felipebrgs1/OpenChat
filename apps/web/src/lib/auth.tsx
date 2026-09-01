import type { MeResponse, PublicUser, TokenResponse } from "@nexo/contracts";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
  const queryClient = useQueryClient();

  const shouldFetch = Boolean(getSession()?.accessToken) || authDisabled();

  const meQuery = useQuery({
    queryKey: ["me"],
    // só busca quando tem token ou auth desabilitado — evita 401 desnecessário
    enabled: shouldFetch,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const me = await api<MeResponse>("/api/me");
      const session = getSession();
      if (session) {
        // mantém token mas atualiza user em cache local
        setSession({ ...session, user: me.user });
      }
      return me;
    },
  });

  // user vem do cache do TanStack; fallback para session (SSR/initial) se query ainda não rodou
  const user: PublicUser | null = meQuery.data?.user ?? getSession()?.user ?? null;
  // ready = já sabemos se está logado ou não. Se não precisa fetch, ready imediato.
  // Se precisa, ready quando query já tentou (success ou error).
  const ready = !shouldFetch ? true : meQuery.isFetched || meQuery.isError;

  const applyTokens = useCallback(
    (tokens: TokenResponse) => {
      setSession(tokens);
      // popula cache ["me"] imediatamente — evita refetch
      queryClient.setQueryData<MeResponse>(["me"], { user: tokens.user } as MeResponse);
    },
    [queryClient],
  );

  const refreshMe = useCallback(async (): Promise<MeResponse | null> => {
    if (!getSession()?.accessToken && !authDisabled()) {
      queryClient.setQueryData(["me"], null);
      return null;
    }
    try {
      // fetchQuery respeita cache + atualiza; invalidate forçaria refetch mas queremos retorno
      const me = await queryClient.fetchQuery<MeResponse>({
        queryKey: ["me"],
        queryFn: async () => {
          const data = await api<MeResponse>("/api/me");
          const session = getSession();
          if (session) setSession({ ...session, user: data.user });
          return data;
        },
        staleTime: 0,
      });
      return me;
    } catch {
      clearSession();
      queryClient.setQueryData(["me"], null);
      return null;
    }
  }, [queryClient]);

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
        // garante que ["me"] está consistente após login
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      },
      async logout() {
        const session = getSession();
        try {
          await api("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({ refreshToken: session?.refreshToken }),
          });
        } catch {
          // logout local mesmo se backend falhar
        }
        clearSession();
        queryClient.setQueryData(["me"], null);
        queryClient.removeQueries({ queryKey: ["me"] });
      },
      async acceptInvite(token, name, password) {
        const tokens = await api<TokenResponse>(`/api/invites/${token}/accept`, {
          method: "POST",
          skipAuth: true,
          body: JSON.stringify({ name, password }),
        });
        applyTokens(tokens);
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      },
      refreshMe,
    }),
    [ready, user, applyTokens, queryClient, refreshMe],
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
