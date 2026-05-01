import { findDocumentsByDocumentNumber } from "@/lib/database";
import type {
  ExtractedDocumentData,
  ValidationIssue
} from "@/lib/documents/types";

function addIssue(
  issues: ValidationIssue[],
  issue: ValidationIssue
): ValidationIssue[] {
  issues.push(issue);
  return issues;
}

function isValidDate(value: string | null) {
  if (!value) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function compareAmounts(left: number, right: number) {
  return Math.abs(left - right) <= 0.01;
}

export async function validateExtractedData(
  data: ExtractedDocumentData,
  currentDocumentId?: string
) {
  const issues: ValidationIssue[] = [];

  if (data.documentType === "unknown") {
    addIssue(issues, {
      code: "document-type-unknown",
      message: "Document type could not be classified as invoice or purchase order.",
      severity: "warning",
      field: "documentType"
    });
  }

  const requiredFields: Array<keyof ExtractedDocumentData> = [
    "supplierName",
    "documentNumber",
    "issueDate",
    "currency",
    "total"
  ];

  for (const field of requiredFields) {
    if (data[field] === null || data[field] === "") {
      addIssue(issues, {
        code: `missing-${field}`,
        message: `${field} is missing.`,
        severity: "error",
        field
      });
    }
  }

  if (data.issueDate && !isValidDate(data.issueDate)) {
    addIssue(issues, {
      code: "invalid-issue-date",
      message: "Issue date is not a valid date.",
      severity: "error",
      field: "issueDate"
    });
  }

  if (data.dueDate && !isValidDate(data.dueDate)) {
    addIssue(issues, {
      code: "invalid-due-date",
      message: "Due date is not a valid date.",
      severity: "error",
      field: "dueDate"
    });
  }

  if (
    data.issueDate &&
    data.dueDate &&
    isValidDate(data.issueDate) &&
    isValidDate(data.dueDate) &&
    new Date(data.dueDate) < new Date(data.issueDate)
  ) {
    addIssue(issues, {
      code: "due-before-issue",
      message: "Due date is earlier than the issue date.",
      severity: "error",
      field: "dueDate"
    });
  }

  for (const [index, lineItem] of data.lineItems.entries()) {
    if (
      lineItem.quantity !== null &&
      lineItem.unitPrice !== null &&
      lineItem.lineTotal !== null
    ) {
      const computed = lineItem.quantity * lineItem.unitPrice;

      if (!compareAmounts(computed, lineItem.lineTotal)) {
        addIssue(issues, {
          code: `line-item-mismatch-${index}`,
          message: `Line item ${index + 1} total does not match quantity x unit price.`,
          severity: "error",
          field: "lineItems"
        });
      }
    }
  }

  if (data.lineItems.length > 0) {
    const lineItemSubtotal = data.lineItems.reduce(
      (sum, item) => sum + (item.lineTotal ?? 0),
      0
    );

    if (data.subtotal !== null && !compareAmounts(lineItemSubtotal, data.subtotal)) {
      addIssue(issues, {
        code: "subtotal-mismatch",
        message: "Subtotal does not match the sum of line items.",
        severity: "error",
        field: "subtotal"
      });
    }

    if (data.subtotal === null) {
      addIssue(issues, {
        code: "missing-subtotal",
        message: "Subtotal is missing.",
        severity: "warning",
        field: "subtotal"
      });
    }
  }

  if (
    data.subtotal !== null &&
    data.tax !== null &&
    data.total !== null &&
    !compareAmounts(data.subtotal + data.tax, data.total)
  ) {
    addIssue(issues, {
      code: "total-mismatch",
      message: "Total does not match subtotal + tax.",
      severity: "error",
      field: "total"
    });
  }

  if (data.documentNumber) {
    const duplicates = await findDocumentsByDocumentNumber(
      data.documentNumber,
      currentDocumentId
    );

    if (duplicates.length > 0) {
      addIssue(issues, {
        code: "duplicate-document-number",
        message: "Another processed document already uses this document number.",
        severity: "error",
        field: "documentNumber"
      });
    }
  }

  return issues;
}
