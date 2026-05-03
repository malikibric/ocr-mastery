import { createHmac, timingSafeEqual } from "node:crypto";
import { getFileAccessSecret } from "@/lib/env";

const FILE_ACCESS_TTL_MS = 15 * 60 * 1000;

function signDocumentFileAccess(documentId: string, expiresAt: number) {
  return createHmac("sha256", getFileAccessSecret())
    .update(`${documentId}:${expiresAt}`)
    .digest("hex");
}

export function createDocumentFileUrl(documentId: string) {
  const expires = Date.now() + FILE_ACCESS_TTL_MS;
  const token = signDocumentFileAccess(documentId, expires);
  const params = new URLSearchParams({
    expires: String(expires),
    token
  });

  return `/api/documents/${encodeURIComponent(documentId)}/file?${params.toString()}`;
}

export function hasValidDocumentFileAccess(
  documentId: string,
  expiresValue: string | null,
  token: string | null
) {
  if (!expiresValue || !token) {
    return false;
  }

  const expiresAt = Number.parseInt(expiresValue, 10);

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const expected = signDocumentFileAccess(documentId, expiresAt);

  if (expected.length !== token.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
