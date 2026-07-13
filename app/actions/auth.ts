"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie, clearSessionCookie } from "@/lib/auth/session";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || !verifyPassword(password, user.passwordHash)) {
    redirect("/signin?error=" + encodeURIComponent("Invalid email or password"));
  }
  const token = await createSession(user.id);
  await setSessionCookie(token);
  redirect("/studio");
}

export async function signOutAction() {
  await clearSessionCookie();
  redirect("/signin");
}
