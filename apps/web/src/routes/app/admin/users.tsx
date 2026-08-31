import type { AdminUser, RoleSummary } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Select } from "@nexo/ui/components/select";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/admin/users")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<{ users: AdminUser[] }>("/api/admin/users"),
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleSummary[] }>("/api/roles"),
  });
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");

  const invite = useMutation({
    mutationFn: () =>
      api<{ acceptPath: string; token: string }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({ email, roleId: roleId || undefined }),
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      const url = `${window.location.origin}${data.acceptPath}`;
      await navigator.clipboard.writeText(url);
      toast.success("Convite criado. Link copiado.");
      setEmail("");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao convidar.");
    },
  });

  const patchUser = useMutation({
    mutationFn: (input: { id: string; body: Record<string, unknown> }) =>
      api(`/api/admin/users/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify(input.body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  return (
    <section className="mx-auto w-full max-w-6xl space-y-8 px-6 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
        <p className="mt-1 text-sm text-muted-foreground">Convite, cargo, admin e status.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            className="h-9 min-w-64 rounded-xl text-sm md:text-sm"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Cargo</Label>
          <Select
            id="invite-role"
            className="min-w-48"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value="">novato (default)</option>
            {roles.data?.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" className="rounded-xl" disabled={invite.isPending}>
          Convidar
        </Button>
      </form>

      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Cargo</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Admin</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-4 py-3">{row.name}</td>
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">
                  <Select
                    className="min-w-40"
                    value={row.roleId ?? ""}
                    onChange={(event) =>
                      patchUser.mutate({
                        id: row.id,
                        body: { roleId: event.target.value || null },
                      })
                    }
                  >
                    <option value="">sem cargo</option>
                    {roles.data?.roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <Select
                    className="min-w-36"
                    value={row.status === "invited" ? "invited" : row.status}
                    disabled={row.status === "invited"}
                    onChange={(event) =>
                      patchUser.mutate({
                        id: row.id,
                        body: { status: event.target.value },
                      })
                    }
                  >
                    {row.status === "invited" ? <option value="invited">convidado</option> : null}
                    <option value="active">ativo</option>
                    <option value="disabled">desativado</option>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={row.isAdmin}
                    onChange={(event) =>
                      patchUser.mutate({
                        id: row.id,
                        body: { isAdmin: event.target.checked },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
