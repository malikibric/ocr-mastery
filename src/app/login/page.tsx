import { redirect } from "next/navigation";
import { loginAction } from "@/app/auth-actions";
import { getReviewerSession } from "@/lib/reviewer-session";

function normalizeNextPath(nextPath: string | undefined) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/";
  }

  return nextPath;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const session = await getReviewerSession();
  const nextPath = normalizeNextPath(params.next);

  if (session) {
    redirect(nextPath);
  }

  const hasCredentialsError = params.error === "credentials";

  return (
    <main className="page-shell">
      <section className="panel" style={{ maxWidth: "32rem", margin: "4rem auto" }}>
        <div className="top-bar">
          <div>
            <p className="muted">Reviewer sign in</p>
            <h1 style={{ marginBottom: 0 }}>Smart Document Processing System</h1>
          </div>
        </div>
        <p className="muted">
          Sign in to review documents, trigger imports, and access the protected
          document APIs.
        </p>

        {hasCredentialsError ? (
          <div className="empty-state" style={{ marginBottom: "1rem" }}>
            The reviewer email or password was incorrect.
          </div>
        ) : null}

        <form action={loginAction}>
          <input name="next" type="hidden" value={nextPath} />
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="field-stack">
              <label htmlFor="email">Reviewer email</label>
              <input autoComplete="email" id="email" name="email" type="email" />
            </div>
            <div className="field-stack">
              <label htmlFor="password">Password</label>
              <input
                autoComplete="current-password"
                id="password"
                name="password"
                type="password"
              />
            </div>
          </div>

          <div className="button-row" style={{ marginTop: "1rem" }}>
            <button className="button" type="submit">
              Sign in
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
