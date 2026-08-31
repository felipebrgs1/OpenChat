import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { authDisabled } from "@/lib/flags";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (authDisabled()) {
      throw redirect({ to: "/app" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <form
        className="w-full max-w-sm space-y-5 rounded-3xl border bg-background p-8 shadow-[0_16px_50px_rgba(0,0,0,0.08)]"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          try {
            await login(email, password);
            await navigate({ to: "/app" });
          } catch (error) {
            const message =
              error instanceof ApiRequestError ? error.message : "Não foi possível entrar.";
            toast.error(message);
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-foreground text-sm font-semibold text-background">
            N
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Nexo</h1>
            <p className="text-sm text-muted-foreground">Entrar com o convite da empresa.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-9 rounded-xl"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-9 rounded-xl"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" className="h-9 w-full rounded-xl" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </main>
  );
}
