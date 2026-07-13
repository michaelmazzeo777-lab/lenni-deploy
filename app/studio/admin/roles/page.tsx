import { requireActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Banner } from "@/app/_ui";
import { assignRoleAction, removeRoleAction } from "@/app/studio/growth-actions";
import { Role } from "@prisma/client";

export const metadata = { title: "Users & roles — Field Guide Studio" };
export const dynamic = "force-dynamic";

const ALL_ROLES = Object.values(Role);

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireActor();
  const { error } = await searchParams;

  if (!can(actor, "role.manage")) {
    return (
      <div>
        <h1>Users &amp; roles</h1>
        <p className="error">Only an Owner can manage roles.</p>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    where: { workspaceId: actor.workspaceId },
    include: { roles: true },
    orderBy: { displayName: "asc" },
  });

  return (
    <div>
      <h1>Users &amp; roles</h1>
      <p className="muted">Least privilege. The last Owner cannot be removed.</p>
      <Banner error={error} />

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Roles</th>
              <th>Add role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const held = new Set(u.roles.map((r) => r.role));
              const addable = ALL_ROLES.filter((r) => !held.has(r));
              return (
                <tr key={u.id}>
                  <td>
                    {u.displayName}
                    <br />
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      {u.email}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {u.roles.map((r) => (
                        <form key={r.id} action={removeRoleAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="role" value={r.role} />
                          <button
                            type="submit"
                            className="secondary"
                            title="Remove role"
                            style={{ padding: "2px 8px", fontSize: "0.78rem" }}
                          >
                            {r.role.replace(/_/g, " ")} ✕
                          </button>
                        </form>
                      ))}
                      {u.roles.length === 0 ? <span className="muted">none</span> : null}
                    </div>
                  </td>
                  <td>
                    {addable.length ? (
                      <form action={assignRoleAction} className="row" style={{ gap: 6 }}>
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="role" aria-label={`Add role for ${u.displayName}`}>
                          {addable.map((r) => (
                            <option key={r} value={r}>
                              {r.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="secondary">
                          Add
                        </button>
                      </form>
                    ) : (
                      <span className="muted">all roles</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
