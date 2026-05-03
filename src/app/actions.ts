"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  parseLineItemsEditorText,
  parseNumericInput
} from "@/lib/documents/parsing";
import { importDatasetDocuments, processUploadedFile } from "@/lib/documents/pipeline";
import { validateExtractedData } from "@/lib/documents/validation";
import {
  deleteDocumentById,
  getDocumentById,
  saveReviewedDocument,
  withDocumentNumberTransaction
} from "@/lib/database";
import type { DocumentKind, DocumentStatus } from "@/lib/documents/types";
import type {
  ReviewFormFields,
  ReviewFormState
} from "@/lib/review-form-state";
import { requireReviewerActionSession } from "@/lib/reviewer-session";

class ReviewFormValidationError extends Error {}

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDocumentType(value: string): DocumentKind {
  if (
    value === "invoice" ||
    value === "purchase_order" ||
    value === "company_details"
  ) {
    return value;
  }

  return "unknown";
}

function getReviewedStatus(
  action: string,
  hasErrors: boolean
): DocumentStatus {
  if (action === "reject") {
    return "rejected";
  }

  if (action === "validate" && !hasErrors) {
    return "validated";
  }

  return "needs_review";
}

function parseReviewedNumericField(label: string, rawValue: string) {
  if (rawValue === "") {
    return null;
  }

  const parsed = parseNumericInput(rawValue);

  if (parsed === null) {
    throw new ReviewFormValidationError(`${label} must be a valid number.`);
  }

  return parsed;
}

function getReviewFormFields(formData: FormData): ReviewFormFields {
  return {
    documentType: getFormValue(formData, "documentType"),
    supplierName: getFormValue(formData, "supplierName"),
    documentNumber: getFormValue(formData, "documentNumber"),
    issueDate: getFormValue(formData, "issueDate"),
    dueDate: getFormValue(formData, "dueDate"),
    currency: getFormValue(formData, "currency"),
    subtotal: getFormValue(formData, "subtotal"),
    tax: getFormValue(formData, "tax"),
    total: getFormValue(formData, "total"),
    lineItems: getFormValue(formData, "lineItems")
  };
}

export async function importDatasetAction() {
  await requireReviewerActionSession("/");
  await importDatasetDocuments();
  revalidatePath("/");
}

export async function uploadDocumentAction(formData: FormData) {
  await requireReviewerActionSession("/");
  const file = formData.get("document");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }

  const documents = await processUploadedFile(file);

  if (!documents.length) {
    throw new Error("Document upload did not produce a saved record.");
  }

  revalidatePath("/");

  if (documents.length === 1) {
    redirect(`/documents/${documents[0].id}`);
  } else {
    redirect(`/#processed-documents`);
  }
}

export async function deleteUploadDocumentAction(formData: FormData) {
  const documentId = getFormValue(formData, "documentId");
  await requireReviewerActionSession("/");
  const existingDocument = await getDocumentById(documentId);

  if (!existingDocument) {
    throw new Error("Document not found.");
  }

  if (existingDocument.sourceType !== "upload") {
    throw new Error("Only uploaded documents can be deleted.");
  }

  await deleteDocumentById(documentId);
  revalidatePath("/");
}

export async function saveReviewAction(
  _previousState: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
  const documentId = getFormValue(formData, "documentId");
  const reviewer = await requireReviewerActionSession(`/documents/${documentId}`);
  const reviewAction = getFormValue(formData, "reviewAction");
  const existingDocument = await getDocumentById(documentId);

  if (!existingDocument) {
    throw new Error("Document not found.");
  }

  const fields = getReviewFormFields(formData);

  let correctedData;
  try {
    correctedData = {
      documentType: normalizeDocumentType(fields.documentType),
      supplierName: fields.supplierName || null,
      documentNumber: fields.documentNumber || null,
      issueDate: fields.issueDate || null,
      dueDate: fields.dueDate || null,
      currency: fields.currency.toUpperCase() || null,
      subtotal: parseReviewedNumericField("Subtotal", fields.subtotal),
      tax: parseReviewedNumericField("Tax", fields.tax),
      total: parseReviewedNumericField("Total", fields.total),
      lineItems: parseLineItemsEditorText(fields.lineItems)
    };
  } catch (error) {
    if (error instanceof ReviewFormValidationError) {
      return {
        message: error.message,
        fields,
        formKey: String(Date.now())
      };
    }

    throw error;
  }

  await withDocumentNumberTransaction(correctedData.documentNumber, async (queryable) => {
    const validationIssues = await validateExtractedData(
      correctedData,
      documentId,
      queryable
    );
    const hasErrors = validationIssues.some((issue) => issue.severity === "error");

    await saveReviewedDocument(
      {
        id: documentId,
        correctedData,
        status: getReviewedStatus(reviewAction, hasErrors),
        validationIssues,
        reviewerEmail: reviewer.reviewerEmail,
        reviewerName: reviewer.reviewerName
      },
      queryable
    );
  });

  revalidatePath("/");
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}
