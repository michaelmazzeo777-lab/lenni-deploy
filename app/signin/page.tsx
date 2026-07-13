import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { signInAction } from "@/app/actions/auth";

export const metadata = { title: "Sign in — Field Guide Studio" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await getActor();
  if (actor) redirect("/studio");
  const { error } = await searchParams;

  return (
    <main id="main" className="container narrow">
      <div className="card" style={{ marginTop: 60 }}>
        <h1>Field Guide Studio</h1>
        <p className="muted">
          Private editorial operating system for the independent Leonida Field Guide. Local
          development sign-in.
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <form action={signInAction}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <div style={{ marginTop: 16 }}>
            <button type="submit">Sign in</button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: 16, fontSize: "0.85rem" }}>
          Demo accounts (seeded): owner@leonida.test, editor@leonida.test, researcher@leonida.test —
          password <code>demo-password-123</code>.
        </p>
      </div>
    </main>
  );
}
