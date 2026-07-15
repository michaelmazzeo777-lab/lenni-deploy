import { test, expect } from "@playwright/test";

// Brute-force throttling at the browser level. Uses a nonexistent email so
// the lock is scoped to this test's email key and cannot affect other
// specs' sign-ins (the shared IP ceiling is deliberately higher).
test("sign-in lockout after repeated failures", async ({ page }) => {
  const email = `bruteforce-${Date.now()}@leonida.test`;
  // Scoped to <main>: Next.js's route announcer is also role="alert".
  const alert = () => page.locator("main").getByRole("alert");

  async function attempt(password: string) {
    await page.goto("/signin");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  // Four failures: still the generic error (no account-existence hint).
  for (let i = 0; i < 4; i++) {
    await attempt(`wrong-${i}`);
    await expect(alert()).toHaveText(/invalid email or password/i);
  }

  // Fifth failure crosses the limit: lockout message.
  await attempt("wrong-final");
  await expect(alert()).toHaveText(/too many failed sign-in attempts/i);

  // While locked, even a further attempt is refused up front.
  await attempt("does-not-matter");
  await expect(alert()).toHaveText(/too many failed sign-in attempts/i);
});
