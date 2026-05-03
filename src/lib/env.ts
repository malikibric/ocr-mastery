import { createHash } from "node:crypto";

const DEVELOPMENT_FILE_ACCESS_SECRET = createHash("sha256")
  .update(`${process.cwd()}:local-file-access`)
  .digest("hex");

function isLocalEnvironment() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

interface RequiredEnvOptions {
  developmentFallback?: string;
}

export function getRequiredEnv(
  name: string,
  options?: RequiredEnvOptions
): string {
  const value = process.env[name]?.trim();

  if (value) {
    return value;
  }

  if (
    isLocalEnvironment() &&
    options?.developmentFallback
  ) {
    return options.developmentFallback;
  }

  throw new Error(
    `Missing required environment variable ${name}. ` +
      "Set it in .env.local or your deployment environment."
  );
}

export function getFileAccessSecret(): string {
  return getRequiredEnv("FILE_ACCESS_SECRET", {
    developmentFallback: DEVELOPMENT_FILE_ACCESS_SECRET
  });
}

export function getReviewerEmail(): string {
  return getRequiredEnv("REVIEWER_EMAIL", {
    developmentFallback: "reviewer@example.com"
  });
}

export function getReviewerPassword(): string {
  return getRequiredEnv("REVIEWER_PASSWORD", {
    developmentFallback: "local-reviewer-password"
  });
}

export function getReviewerName(): string {
  return process.env.REVIEWER_NAME?.trim() || "Reviewer";
}
