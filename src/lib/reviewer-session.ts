import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export interface ReviewerSession {
  reviewerEmail: string;
  reviewerName: string | null;
}

function normalizeNextPath(nextPath: string) {
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }

  return nextPath;
}

function buildLoginRedirect(nextPath: string) {
  const params = new URLSearchParams({
    next: normalizeNextPath(nextPath)
  });

  return `/login?${params.toString()}`;
}

export async function getReviewerSession(): Promise<ReviewerSession | null> {
  const session = await auth();

  if (!session?.user?.email?.trim()) {
    return null;
  }

  return {
    reviewerEmail: session.user.email.trim(),
    reviewerName: session.user?.name ?? null
  };
}

export async function requireReviewerPageSession(nextPath: string) {
  const session = await getReviewerSession();

  if (!session) {
    redirect(buildLoginRedirect(nextPath));
  }

  return session;
}

export async function requireReviewerActionSession(nextPath: string) {
  const session = await getReviewerSession();

  if (!session) {
    redirect(buildLoginRedirect(nextPath));
  }

  return session;
}

export async function requireReviewerApiSession() {
  return getReviewerSession();
}

export function unauthorizedApiResponse() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}
