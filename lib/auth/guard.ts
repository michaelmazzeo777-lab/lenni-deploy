import { redirect } from "next/navigation";
import { getActor, type Actor } from "@/lib/auth/context";

// Studio page components call this instead of requireActor(). An
// unauthenticated request is redirected to /signin via Next's NEXT_REDIRECT
// control-flow signal, which Next handles cleanly. requireActor() throws a
// DomainError ("Sign in required") that logs a spurious stack trace on every
// logged-out hit before the layout's own redirect resolves — pure noise that
// would bury real errors in production. Server actions keep using
// requireActor(): a thrown error is the correct outcome there.
export async function requireStudioActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/signin");
  return actor;
}
