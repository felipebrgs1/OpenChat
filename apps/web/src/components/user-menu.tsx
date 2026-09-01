import type { PublicUser } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nexo/ui/components/dropdown-menu";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpenText,
  ChartBar,
  ChevronsUpDown,
  Cpu,
  Settings2,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
} from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/lib/auth";
import { authDisabled } from "@/lib/flags";

export function UserMenu({ user, roleName }: { user: PublicUser | null; roleName?: string }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-sidebar-accent"
          />
        }
      >
        <UserAvatar name={user?.name} email={user?.email} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-sidebar-foreground">
            {user?.name ?? "Conta"}
          </span>
          <span className="block truncate text-[11px] text-sidebar-foreground/55">
            {roleName ?? user?.email}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/45" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[248px] rounded-2xl p-1"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2">
            <p className="truncate text-xs font-medium text-foreground">{user?.email}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="rounded-lg"
            onClick={() => void navigate({ to: "/app/settings" })}
          >
            <Settings className="size-4" />
            Perfil
          </DropdownMenuItem>
          {user?.isAdmin ? (
            <>
              <DropdownMenuItem
                className="rounded-lg"
                onClick={() => void navigate({ to: "/app/admin/users" })}
              >
                <Users className="size-4" />
                Usuários
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg"
                onClick={() => void navigate({ to: "/app/admin/roles" })}
              >
                <Shield className="size-4" />
                Cargos
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg"
                onClick={() => void navigate({ to: "/app/admin/models" })}
              >
                <Cpu className="size-4" />
                Modelos
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg"
                onClick={() => void navigate({ to: "/app/admin/knowledge" })}
              >
                <BookOpenText className="size-4" />
                Bases
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg"
                onClick={() => void navigate({ to: "/app/admin/usage" })}
              >
                <ChartBar className="size-4" />
                Uso
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg"
                onClick={() => void navigate({ to: "/app/admin/settings" })}
              >
                <Settings2 className="size-4" />
                Configurações
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">Tema</DropdownMenuLabel>
          <DropdownMenuItem className="rounded-lg" onClick={() => setTheme("light")}>
            <Sun className="size-4" />
            Claro
            {theme === "light" ? (
              <span className="ml-auto text-[11px] text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem className="rounded-lg" onClick={() => setTheme("dark")}>
            <Moon className="size-4" />
            Escuro
            {theme === "dark" ? (
              <span className="ml-auto text-[11px] text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem className="rounded-lg" onClick={() => setTheme("system")}>
            <Monitor className="size-4" />
            Sistema
            {theme === "system" ? (
              <span className="ml-auto text-[11px] text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {authDisabled() ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="rounded-lg"
              onClick={async () => {
                await logout();
                await navigate({ to: "/login" });
              }}
            >
              <LogOut className="size-4" />
              Sair
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
