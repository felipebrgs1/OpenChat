import type { MeResponse } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { cn } from "@nexo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { BookOpenText, MessageSquarePlus } from "lucide-react";

import { ConversationList } from "@/components/chat/conversation-list";
import { ModelSelect } from "@/components/chat/model-select";
import { ModelProvider } from "@/components/model-provider";
import { UserMenu } from "@/components/user-menu";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { authDisabled } from "@/lib/flags";
import { getSession } from "@/lib/session";

export const Route = createFileRoute("/app")({
  beforeLoad: () => {
    if (!authDisabled() && !getSession()?.accessToken) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppShell,
});

function AppShell() {
  return (
    <ModelProvider>
      <AppShellInner />
    </ModelProvider>
  );
}

function AppShellInner() {
  const { user, ready } = useAuth();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
    enabled: ready,
  });
  const roleName = me.data?.role?.name;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const onChat = pathname === "/app/chat" || pathname.startsWith("/app/chat/");

  if (!ready) {
    return (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="grid h-svh grid-cols-[272px_1fr] bg-background">
      <aside className="flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <span className="inline-flex size-8 items-center justify-center rounded-xl bg-foreground text-[13px] font-semibold text-background">
            N
          </span>
          <div className="min-w-0">
            <Link to="/app" className="block text-[15px] font-semibold tracking-tight">
              Nexo
            </Link>
            <p className="truncate text-[11px] text-sidebar-foreground/55">
              {roleName ?? "Assistente interno"}
            </p>
          </div>
        </div>
        <div className="px-3 pb-3">
          <Link to="/app/chat" className="block">
            <Button
              variant="outline"
              className="h-9 w-full justify-start gap-2 rounded-xl bg-background"
            >
              <MessageSquarePlus className="size-4" />
              Nova conversa
            </Button>
          </Link>
          <Link
            to="/app/knowledge"
            className={cn(
              "mt-1 flex h-8 items-center gap-2 rounded-xl px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              pathname.startsWith("/app/knowledge") && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <BookOpenText className="size-4" />
            Bases
          </Link>
          <Link
            to="/app/documents"
            className={cn(
              "flex h-8 items-center gap-2 rounded-xl px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              pathname.startsWith("/app/documents") && !pathname.startsWith("/app/admin") && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <BookOpenText className="size-4" />
            Meus documentos
          </Link>
          {me.data?.user.isAdmin ? (
            <Link
              to="/app/admin/documents"
              className={cn(
                "flex h-8 items-center gap-2 rounded-xl px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                pathname.startsWith("/app/admin/documents") && "bg-sidebar-accent text-sidebar-foreground",
              )}
            >
              <BookOpenText className="size-4" />
              Painel docs (admin)
            </Link>
          ) : null}
        </div>
        <div className="px-5 pb-1.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/45">
            Histórico
          </p>
        </div>
        <div className="min-h-0 flex-1">
          <ConversationList />
        </div>
        <div className="border-t border-sidebar-border p-2 space-y-2">
          {me.data?.user ? (
            <div className="flex items-center justify-between rounded-xl bg-amber-100 px-3 py-2 text-xs dark:bg-amber-900/30">
              <span className="font-medium text-amber-800 dark:text-amber-200">Saldo</span>
              <span className="font-mono font-semibold text-amber-900 dark:text-amber-100">
                {Number(me.data.user.creditBalance).toFixed(2)} créditos
              </span>
            </div>
          ) : null}
          <UserMenu user={user} roleName={roleName} />
        </div>
      </aside>
      <div className="flex min-h-0 flex-col">
        {onChat ? (
          <header className="flex h-12 shrink-0 items-center gap-3 px-3">
            <ModelSelect />
          </header>
        ) : null}
        <main className={cn("min-h-0 flex-1", onChat ? "overflow-hidden" : "overflow-y-auto")}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
