import type { DocumentStatus, ValidationSeverity } from "@/lib/documents/types";

export function getStatusLabel(status: DocumentStatus) {
  switch (status) {
    case "uploaded":
      return "Uploaded";
    case "needs_review":
      return "Needs Review";
    case "validated":
      return "Validated";
    case "rejected":
      return "Rejected";
  }
}

export function getStatusTone(status: DocumentStatus) {
  switch (status) {
    case "uploaded":
      return "neutral";
    case "needs_review":
      return "warning";
    case "validated":
      return "success";
    case "rejected":
      return "danger";
  }
}

export function getSeverityTone(severity: ValidationSeverity) {
  return severity === "error" ? "danger" : "warning";
}

export function formatAmount(value: number | null, currency?: string | null) {
  if (value === null) {
    return "—";
  }

  return currency ? `${value.toFixed(2)} ${currency}` : value.toFixed(2);
}

export function formatDate(value: string | null) {
  return value ?? "—";
}
