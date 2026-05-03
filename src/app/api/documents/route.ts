import { NextResponse } from "next/server";
import { listDocumentSummaries } from "@/lib/database";
import {
  requireReviewerApiSession,
  unauthorizedApiResponse
} from "@/lib/reviewer-session";

export async function GET() {
  const session = await requireReviewerApiSession();

  if (!session) {
    return unauthorizedApiResponse();
  }

  const documents = await listDocumentSummaries();

  return NextResponse.json({ documents });
}
