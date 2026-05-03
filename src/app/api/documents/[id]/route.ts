import { NextResponse } from "next/server";
import { getDocumentById, listReviewEvents, toDocumentSummary } from "@/lib/database";
import { createDocumentFileUrl } from "@/lib/documents/file-access";
import {
  requireReviewerApiSession,
  unauthorizedApiResponse
} from "@/lib/reviewer-session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await requireReviewerApiSession();

  if (!session) {
    return unauthorizedApiResponse();
  }

  const { id } = await context.params;
  const document = await getDocumentById(id);

  if (!document) {
    return NextResponse.json(
      { error: "Document not found." },
      { status: 404 }
    );
  }

  const publicDocument = toDocumentSummary(document);

  return NextResponse.json({
    document: publicDocument,
    activeData: publicDocument.activeData,
    reviewEvents: await listReviewEvents(id),
    fileUrl: createDocumentFileUrl(document.id)
  });
}
