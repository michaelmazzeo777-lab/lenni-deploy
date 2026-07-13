import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/auth/context";
import { signOutAction } from "@/app/actions/auth";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/signin");

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Studio navigation">
        <div className="brand">Field Guide Studio</div>
        <p className="muted" style={{ fontSize: "0.78rem" }}>
          {actor.displayName}
          <br />
          <span className="muted">{actor.roles.join(", ")}</span>
        </p>

        <h2>Overview</h2>
        <Link href="/studio">Dashboard</Link>
        <Link href="/studio/audit">Audit log</Link>

        <h2>Content</h2>
        <Link href="/studio/content">Backlog</Link>
        <Link href="/studio/board">Production board</Link>
        <Link href="/studio/calendar">Calendar</Link>
        <Link href="/studio/updates">Update queue</Link>

        <h2>Research</h2>
        <Link href="/studio/sources">Sources</Link>
        <Link href="/studio/claims">Claims</Link>

        <h2>Growth</h2>
        <Link href="/studio/analytics">Analytics</Link>

        <h2>Administration</h2>
        {actor.roles.includes("OWNER") ? (
          <Link href="/studio/admin/roles">Users &amp; roles</Link>
        ) : null}
        <Link href="/studio/export/content?format=csv">Export content (CSV)</Link>
        <Link href="/studio/export/claims?format=csv">Export claims (CSV)</Link>
        <Link href="/studio/export/audit?format=json">Export audit (JSON)</Link>

        <h2>Public</h2>
        <Link href="/" target="_blank">
          View public site ↗
        </Link>

        <form action={signOutAction} style={{ marginTop: 24 }}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </nav>
      <main id="main" className="main">
        {children}
      </main>
    </div>
  );
}
