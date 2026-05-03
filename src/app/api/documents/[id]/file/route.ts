import path from "node:path";
import fs from "node:fs/promises";
import { getDocumentById } from "@/lib/database";
import { hasValidDocumentFileAccess } from "@/lib/documents/file-access";
import {
  requireReviewerApiSession,
  unauthorizedApiResponse
} from "@/lib/reviewer-session";

const UPLOAD_ROOT = path.resolve(process.cwd(), "data", "uploads");
const DATASET_ROOT = path.resolve(process.cwd(), "resources");

function isPathWithinRoot(root: string, candidatePath: string) {
  const relativePath = path.relative(root, path.resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function hasAllowedDocumentSourcePath(
  sourceType: "dataset" | "upload",
  sourcePath: string
) {
  const allowedRoot = sourceType === "upload" ? UPLOAD_ROOT : DATASET_ROOT;
  return isPathWithinRoot(allowedRoot, sourcePath);
}

function buildContentDisposition(sourceName: string) {
  const asciiFileName = sourceName.replace(/["\\\r\n]/g, "_");
  const encodedFileName = encodeURIComponent(sourceName);

  return `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireReviewerApiSession();

  if (!session) {
    return unauthorizedApiResponse();
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);

  if (
    !hasValidDocumentFileAccess(
      id,
      searchParams.get("expires"),
      searchParams.get("token")
    )
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const document = await getDocumentById(id);

  if (!document) {
    return new Response("Not found", { status: 404 });
  }

  if (!hasAllowedDocumentSourcePath(document.sourceType, document.sourcePath)) {
    return new Response("Forbidden", { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(document.sourcePath);
  } catch {
    return new Response("File not found on disk", { status: 404 });
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": buildContentDisposition(document.sourceName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600"
    }
  });
}
