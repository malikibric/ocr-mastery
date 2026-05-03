import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type {
  ExtractedDocumentData,
  PersistDocumentInput
} from "@/lib/documents/types";

function getTestDatabaseUrl() {
  const explicitUrl = process.env.DATABASE_URL?.trim();

  if (explicitUrl) {
    return explicitUrl;
  }

  const envPath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) {
    return null;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const line = content
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("DATABASE_URL="));

  if (!line) {
    return null;
  }

  return line.slice("DATABASE_URL=".length).replace(/^['"]|['"]$/g, "").trim();
}

const databaseUrl = getTestDatabaseUrl();

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration("database integration", () => {
  let database: typeof import("@/lib/database");
  const createdIds = new Set<string>();

  beforeAll(async () => {
    database = await import("@/lib/database");
  });

  afterEach(async () => {
    for (const id of createdIds) {
      await database.deleteDocumentById(id);
    }

    createdIds.clear();
  });

  function buildExtractedData(
    overrides: Partial<ExtractedDocumentData> = {}
  ): ExtractedDocumentData {
    return {
      documentType: "invoice",
      supplierName: "Acme Corp",
      documentNumber: `INV-${crypto.randomUUID()}`,
      issueDate: "2024-01-15",
      dueDate: "2024-02-15",
      currency: "EUR",
      subtotal: 100,
      tax: 20,
      total: 120,
      lineItems: [],
      ...overrides
    };
  }

  function buildPersistInput(
    id: string,
    overrides: Partial<PersistDocumentInput> = {}
  ): PersistDocumentInput {
    return {
      id,
      sourceName: `${id}.pdf`,
      sourceType: "upload",
      mimeType: "application/pdf",
      fileExtension: "pdf",
      sourcePath: path.join("/tmp", `${id}.pdf`),
      rawText: "Invoice Number: INV-001",
      extractedData: buildExtractedData(),
      validationIssues: [],
      status: "uploaded",
      ...overrides
    };
  }

  it("saves and reads processed documents", async () => {
    const id = `itest-save-${crypto.randomUUID()}`;
    createdIds.add(id);

    await database.saveProcessedDocument(buildPersistInput(id));
    const saved = await database.getDocumentById(id);

    expect(saved?.id).toBe(id);
    expect(saved?.sourceName).toBe(`${id}.pdf`);
    expect(saved?.correctedData).toBeNull();
    expect(saved?.validationIssues).toEqual([]);
  });

  it("stores reviewer identity in review events", async () => {
    const id = `itest-review-${crypto.randomUUID()}`;
    createdIds.add(id);

    const extractedData = buildExtractedData({ documentNumber: `REV-${id}` });
    await database.saveProcessedDocument(
      buildPersistInput(id, {
        extractedData,
        rawText: "Invoice Number: review"
      })
    );

    await database.saveReviewedDocument({
      id,
      correctedData: {
        ...extractedData,
        supplierName: "Reviewed Supplier"
      },
      status: "validated",
      validationIssues: [],
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });

    const reviewEvents = await database.listReviewEvents(id);

    expect(reviewEvents[0]).toEqual(
      expect.objectContaining({
        action: "review_saved",
        reviewer_email: "reviewer@example.com",
        reviewer_name: "Reviewer"
      })
    );
  });

  it("returns sibling documents that share the same upload path", async () => {
    const firstId = `itest-sibling-a-${crypto.randomUUID()}`;
    const secondId = `itest-sibling-b-${crypto.randomUUID()}`;
    const sharedPath = path.join("/tmp", `shared-${crypto.randomUUID()}.pdf`);
    createdIds.add(firstId);
    createdIds.add(secondId);

    await database.saveProcessedDocument(
      buildPersistInput(firstId, {
        sourceName: "Sibling 1.pdf",
        sourcePath: sharedPath,
        extractedData: buildExtractedData({ documentNumber: `SIB-${firstId}` })
      })
    );
    await database.saveProcessedDocument(
      buildPersistInput(secondId, {
        sourceName: "Sibling 2.pdf",
        sourcePath: sharedPath,
        extractedData: buildExtractedData({ documentNumber: `SIB-${secondId}` })
      })
    );

    const siblings = await database.getSiblingDocuments(sharedPath, firstId);

    expect(siblings).toEqual([{ id: secondId, sourceName: "Sibling 2.pdf" }]);
  });

  it("clears stale corrected data on processed-document upsert", async () => {
    const id = `itest-upsert-${crypto.randomUUID()}`;
    createdIds.add(id);

    const initialData = buildExtractedData({ documentNumber: `UPS-${id}` });
    await database.saveProcessedDocument(
      buildPersistInput(id, { extractedData: initialData })
    );

    await database.saveReviewedDocument({
      id,
      correctedData: {
        ...initialData,
        supplierName: "Reviewed Supplier"
      },
      status: "validated",
      validationIssues: [],
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });

    const updated = await database.saveProcessedDocument(
      buildPersistInput(id, {
        extractedData: {
          ...initialData,
          supplierName: "Fresh Extraction"
        },
        status: "uploaded"
      })
    );

    expect(updated?.correctedData).toBeNull();
    expect(updated?.extractedData.supplierName).toBe("Fresh Extraction");
    expect(updated?.status).toBe("uploaded");
  });
});
