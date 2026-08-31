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
    <main className="flex min-h-svh items-center justify-center px-4">
      <form
        className="w-full max-w-sm space-y-4"
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nexo</h1>
          <p className="mt-1 text-sm text-muted-foreground">Entrar com o convite da empresa.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </main>
  );
}
