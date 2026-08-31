import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const [api, setApi] = useState<"ok" | "down" | "loading">("loading");
  const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

  useEffect(() => {
    fetch(`${serverUrl}/api/health`)
      .then((response) => setApi(response.ok ? "ok" : "down"))
      .catch(() => setApi("down"));
  }, [serverUrl]);

  const statusLabel =
    api === "loading" ? "verificando…" : api === "ok" ? "ok" : "fora do ar";

  return (
    <main className="flex min-h-full items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Nexo</h1>
        <p className="mt-2 text-muted-foreground">Assistente interno.</p>
        <p className="mt-6 text-sm text-muted-foreground">API: {statusLabel}</p>
      </div>
    </main>
  );
}
