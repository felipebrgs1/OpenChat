import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { OraculoBadge } from "@nexo/ui/components/logo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
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
            await acceptInvite(token, name, password);
            await navigate({ to: "/app" });
          } catch (error) {
            const message =
              error instanceof ApiRequestError ? error.message : "Convite inválido ou expirado.";
            toast.error(message);
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <OraculoBadge size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Aceitar convite</h1>
            <p className="text-sm text-muted-foreground">
              Defina nome e senha para entrar no Oráculo.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            className="h-9 rounded-xl"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            className="h-9 rounded-xl"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" className="h-9 w-full rounded-xl" disabled={pending}>
          {pending ? "Salvando…" : "Criar senha e entrar"}
        </Button>
      </form>
    </main>
  );
}
