import { NextResponse } from "next/server";
import { getActiveDocumentData } from "@/lib/documents/defaults";
import { getDocumentById, listReviewEvents } from "@/lib/database";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const document = await getDocumentById(id);

  if (!document) {
    return NextResponse.json(
      { error: "Document not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    document,
    activeData: getActiveDocumentData(document),
    reviewEvents: await listReviewEvents(id)
  });
}
