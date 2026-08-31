import { Button } from "@nexo/ui/components/button";
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";

import { ModeToggle } from "@/components/mode-toggle";
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
  const { user, logout, ready } = useAuth();
  const navigate = useNavigate();

  if (!ready) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  return (
    <div className="grid h-svh grid-cols-[260px_1fr]">
      <aside className="flex flex-col border-r bg-card">
        <div className="px-4 py-4">
          <Link to="/app" className="text-lg font-semibold tracking-tight">
            Nexo
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">{user?.name ?? user?.email}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 text-sm">
          <Link
            to="/app"
            className="rounded-none px-2 py-1.5 hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
            activeOptions={{ exact: true }}
          >
            Início
          </Link>
          <Link
            to="/app/settings"
            className="rounded-none px-2 py-1.5 hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
          >
            Perfil
          </Link>
          {user?.isAdmin ? (
            <>
              <p className="mt-4 px-2 text-xs uppercase tracking-wide text-muted-foreground">
                Admin
              </p>
              <Link
                to="/app/admin/users"
                className="rounded-none px-2 py-1.5 hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
              >
                Usuários
              </Link>
              <Link
                to="/app/admin/roles"
                className="rounded-none px-2 py-1.5 hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
              >
                Cargos
              </Link>
            </>
          ) : null}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-3">
          <ModeToggle />
          {authDisabled() ? null : (
            <Button
              variant="ghost"
              onClick={async () => {
                await logout();
                await navigate({ to: "/login" });
              }}
            >
              Sair
            </Button>
          )}
        </div>
      </aside>
      <main className="overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
