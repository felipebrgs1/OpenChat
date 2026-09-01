import type { AdminUsageResponse } from "@nexo/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "@/lib/api";

export const Route = createFileRoute("/app/admin/usage")({
  component: AdminUsagePage,
});

function BucketTable({
  title,
  rows,
  budget,
}: {
  title: string;
  rows: { key: string; label: string; messages: number; costUsd: string; credits: string }[];
  budget?: (key: string) => string | null;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Sem uso no período.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">{title}</th>
                <th className="px-4 py-2.5 font-medium">Mensagens</th>
                <th className="px-4 py-2.5 font-medium">Créditos</th>
                <th className="px-4 py-2.5 font-medium">USD</th>
                {budget ? <th className="px-4 py-2.5 font-medium">Orçamento</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const budgetValue = budget?.(row.key) ?? null;
                const over =
                  budgetValue !== null && row.key !== "—" && Number(row.costUsd) >= Number(budgetValue);
                return (
                  <tr key={row.key} className="border-b last:border-0">
                    <td className="px-4 py-2.5">{row.label}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.messages}</td>
                    <td className="px-4 py-2.5 tabular-nums">{Number(row.credits).toFixed(2)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{Number(row.costUsd).toFixed(4)}</td>
                    {budget ? (
                      <td className="px-4 py-2.5">
                        {budgetValue === null ? (
                          <span className="text-xs text-muted-foreground">sem limite</span>
                        ) : (
                          <span
                            className={
                              over
                                ? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-200"
                                : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                            }
                          >
                            {Number(budgetValue).toFixed(2)} USD/mês
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminUsageInner({ data }: { data: AdminUsageResponse }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border p-4">
          <p className="text-xs uppercase text-muted-foreground">Mensagens</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.total.messages}</p>
        </div>
        <div className="rounded-2xl border p-4">
          <p className="text-xs uppercase text-muted-foreground">Créditos</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {Number(data.total.credits).toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border p-4">
          <p className="text-xs uppercase text-muted-foreground">Custo (USD)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {Number(data.total.costUsd).toFixed(4)}
          </p>
        </div>
      </div>

      <BucketTable title="Usuários" rows={data.byUser} />
      <BucketTable
        title="Cargos (mês corrente)"
        rows={data.byRole}
        budget={(key) => data.byRole.find((row) => row.key === key)?.budgetUsd ?? null}
      />
      <BucketTable title="Modelos" rows={data.byModel} />
      <BucketTable title="Dias" rows={data.byDay} />
    </div>
  );
}

function AdminUsagePage() {
  const [days, setDays] = useState("7");
  const usage = useQuery({
    queryKey: ["admin-usage", days],
    queryFn: () => api<AdminUsageResponse>(`/api/admin/usage?days=${days}`),
  });

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Uso e gasto</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranking da semana · créditos (1000 = US$1)
          </p>
        </div>
        <select
          className="h-9 rounded-xl border border-input bg-background px-3 text-sm md:text-sm"
          value={days}
          onChange={(event) => setDays(event.target.value)}
        >
          <option value="1">Últimas 24h</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
        </select>
      </div>

      {usage.isLoading || !usage.data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <AdminUsageInner data={usage.data} />
      )}

      <p className="text-xs text-muted-foreground">
        Orçamento por usuário:{" "}
        <Link to="/app/admin/users" className="underline">
          Usuários
        </Link>{" "}
        · por cargo:{" "}
        <Link to="/app/admin/roles" className="underline">
          Cargos
        </Link>{" "}
        · da org:{" "}
        <Link to="/app/admin/settings" className="underline">
          Configurações
        </Link>
      </p>
    </section>
  );
}
