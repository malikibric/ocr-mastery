"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

function normalizeNextPath(nextPath: string) {
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }

  return nextPath;
}

export async function loginAction(formData: FormData) {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const nextValue = formData.get("next");
  const email = typeof emailValue === "string" ? emailValue : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const nextPath = normalizeNextPath(
    typeof nextValue === "string" ? nextValue : "/"
  );

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: nextPath
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const params = new URLSearchParams({
        error: "credentials",
        next: nextPath
      });
      redirect(`/login?${params.toString()}`);
    }

    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
