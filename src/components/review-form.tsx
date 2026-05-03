"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveReviewAction } from "@/app/actions";
import type { ExtractedDocumentData } from "@/lib/documents/types";
import { serializeLineItemsEditorText } from "@/lib/documents/parsing";
import {
  INITIAL_REVIEW_FORM_STATE,
  type ReviewFormFields
} from "@/lib/review-form-state";

interface ReviewFormProps {
  documentId: string;
  activeData: ExtractedDocumentData;
}

function SubmitButton({
  children,
  className,
  value,
  style
}: {
  children: React.ReactNode;
  className: string;
  value: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending}
      name="reviewAction"
      style={style}
      type="submit"
      value={value}
    >
      {children}
    </button>
  );
}

function getInitialFields(activeData: ExtractedDocumentData): ReviewFormFields {
  return {
    documentType: activeData.documentType,
    supplierName: activeData.supplierName ?? "",
    documentNumber: activeData.documentNumber ?? "",
    issueDate: activeData.issueDate ?? "",
    dueDate: activeData.dueDate ?? "",
    currency: activeData.currency ?? "",
    subtotal: activeData.subtotal === null ? "" : String(activeData.subtotal),
    tax: activeData.tax === null ? "" : String(activeData.tax),
    total: activeData.total === null ? "" : String(activeData.total),
    lineItems: serializeLineItemsEditorText(activeData.lineItems)
  };
}

export function ReviewForm({ documentId, activeData }: ReviewFormProps) {
  const [state, formAction] = useActionState(
    saveReviewAction,
    INITIAL_REVIEW_FORM_STATE
  );
  const fields = state.fields ?? getInitialFields(activeData);

  return (
    <form action={formAction} key={state.formKey}>
      <input name="documentId" type="hidden" value={documentId} />

      {state.message ? (
        <div className="empty-state" style={{ marginBottom: "1rem" }}>
          {state.message}
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field-stack">
          <label htmlFor="documentType">Document type</label>
          <select defaultValue={fields.documentType} id="documentType" name="documentType">
            <option value="unknown">Unknown</option>
            <option value="invoice">Invoice</option>
            <option value="purchase_order">Purchase order</option>
            <option value="company_details">Company details</option>
          </select>
        </div>
        <div className="field-stack">
          <label htmlFor="supplierName">Supplier / company</label>
          <input defaultValue={fields.supplierName} id="supplierName" name="supplierName" />
        </div>
        <div className="field-stack">
          <label htmlFor="documentNumber">Document number</label>
          <input
            defaultValue={fields.documentNumber}
            id="documentNumber"
            name="documentNumber"
          />
        </div>
        <div className="field-stack">
          <label htmlFor="issueDate">Issue date</label>
          <input
            defaultValue={fields.issueDate}
            id="issueDate"
            name="issueDate"
            placeholder="YYYY-MM-DD"
          />
        </div>
        <div className="field-stack">
          <label htmlFor="dueDate">Due date</label>
          <input
            defaultValue={fields.dueDate}
            id="dueDate"
            name="dueDate"
            placeholder="YYYY-MM-DD"
          />
        </div>
        <div className="field-stack">
          <label htmlFor="currency">Currency</label>
          <input defaultValue={fields.currency} id="currency" name="currency" />
        </div>
        <div className="field-stack">
          <label htmlFor="subtotal">Subtotal</label>
          <input defaultValue={fields.subtotal} id="subtotal" name="subtotal" />
        </div>
        <div className="field-stack">
          <label htmlFor="tax">Tax</label>
          <input defaultValue={fields.tax} id="tax" name="tax" />
        </div>
        <div className="field-stack">
          <label htmlFor="total">Total</label>
          <input defaultValue={fields.total} id="total" name="total" />
        </div>
      </div>

      <div className="field-stack" style={{ marginTop: "1rem" }}>
        <label htmlFor="lineItems">Line items</label>
        <textarea defaultValue={fields.lineItems} id="lineItems" name="lineItems" />
        <p className="muted" style={{ margin: 0 }}>
          One line per item in the format: description | qty | unit price | total
        </p>
      </div>

      <div className="button-row" style={{ marginTop: "1rem" }}>
        <SubmitButton className="button-secondary" value="save">
          Save corrections
        </SubmitButton>
        <SubmitButton className="button" value="validate">
          Mark validated
        </SubmitButton>
        <SubmitButton
          className="button-secondary"
          style={{ borderColor: "var(--danger-border)", color: "var(--danger)" }}
          value="reject"
        >
          Reject document
        </SubmitButton>
      </div>
    </form>
  );
}
