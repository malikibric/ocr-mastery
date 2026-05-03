import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  getReviewerEmail,
  getReviewerName,
  getReviewerPassword
} from "@/lib/env";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getAuthSecret() {
  const explicitSecret = process.env.AUTH_SECRET?.trim();

  if (explicitSecret) {
    return explicitSecret;
  }

  const fileAccessSecret = process.env.FILE_ACCESS_SECRET?.trim();

  if (fileAccessSecret) {
    return fileAccessSecret;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return createHash("sha256").update(databaseUrl).digest("hex");
  }

  return createHash("sha256")
    .update(`${process.cwd()}:local-auth-secret`)
    .digest("hex");
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: getAuthSecret(),
  pages: {
    signIn: "/login"
  },
  session: {
    strategy: "jwt"
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      authorize(credentials) {
        const submittedEmail =
          typeof credentials.email === "string" ? credentials.email.trim() : "";
        const submittedPassword =
          typeof credentials.password === "string" ? credentials.password : "";

        if (!submittedEmail || !submittedPassword) {
          return null;
        }

        const reviewerEmail = getReviewerEmail();
        const reviewerPassword = getReviewerPassword();

        if (
          !safeEqual(submittedEmail, reviewerEmail) ||
          !safeEqual(submittedPassword, reviewerPassword)
        ) {
          return null;
        }

        return {
          id: reviewerEmail,
          email: reviewerEmail,
          name: getReviewerName()
        };
      }
    })
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }

      if (user?.name) {
        token.name = user.name;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.email =
          typeof token.email === "string" ? token.email : session.user.email;
        session.user.name =
          typeof token.name === "string" ? token.name : session.user.name;
      }

      return session;
    }
  }
});
