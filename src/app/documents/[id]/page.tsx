import Link from "next/link";
import { notFound } from "next/navigation";
import { saveReviewAction } from "@/app/actions";
import { getActiveDocumentData } from "@/lib/documents/defaults";
import {
  formatAmount,
  formatDate,
  getSeverityTone,
  getStatusLabel,
  getStatusTone
} from "@/lib/documents/presentation";
import { serializeLineItemsEditorText } from "@/lib/documents/parsing";
import { getDocumentById, listReviewEvents } from "@/lib/database";

export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await getDocumentById(id);

  if (!document) {
    notFound();
  }

  const activeData = getActiveDocumentData(document);
  const reviewEvents = await listReviewEvents(document.id);

  return (
    <main className="page-shell">
      <section className="panel">
        <div className="top-bar">
          <div>
            <Link className="back-link" href="/">← Back to dashboard</Link>
            <h1 style={{ margin: "0 0 0.375rem", fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{document.sourceName}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {document.sourceType} · {document.mimeType}
            </p>
          </div>
          <span className="pill" data-tone={getStatusTone(document.status)}>
            {getStatusLabel(document.status)}
          </span>
        </div>
      </section>

      <section className="details-grid">
        <article className="panel">
          <h2>Current extracted data</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th>Document type</th>
                  <td>{activeData.documentType.replace("_", " ")}</td>
                </tr>
                <tr>
                  <th>Supplier</th>
                  <td>{activeData.supplierName ?? "—"}</td>
                </tr>
                <tr>
                  <th>Document number</th>
                  <td>{activeData.documentNumber ?? "—"}</td>
                </tr>
                <tr>
                  <th>Issue date</th>
                  <td>{formatDate(activeData.issueDate)}</td>
                </tr>
                <tr>
                  <th>Due date</th>
                  <td>{formatDate(activeData.dueDate)}</td>
                </tr>
                <tr>
                  <th>Currency</th>
                  <td>{activeData.currency ?? "—"}</td>
                </tr>
                <tr>
                  <th>Subtotal</th>
                  <td>{formatAmount(activeData.subtotal, activeData.currency)}</td>
                </tr>
                <tr>
                  <th>Tax</th>
                  <td>{formatAmount(activeData.tax, activeData.currency)}</td>
                </tr>
                <tr>
                  <th>Total</th>
                  <td>{formatAmount(activeData.total, activeData.currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h2>Validation findings</h2>
          {document.validationIssues.length > 0 ? (
            <ul className="issue-list">
              {document.validationIssues.map((issue) => (
                <li className="issue-item" key={`${issue.code}-${issue.message}`}>
                  <div className="top-bar">
                    <strong>{issue.message}</strong>
                    <span className="pill" data-tone={getSeverityTone(issue.severity)}>
                      {issue.severity}
                    </span>
                  </div>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Field: {issue.field}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No validation issues detected.</p>
          )}

          {document.processingError ? (
            <>
              <h3 style={{ marginTop: "1.25rem" }}>Processing error</h3>
              <p className="muted">{document.processingError}</p>
            </>
          ) : null}
        </article>
      </section>

      <section className="panel">
        <h2>Review and corrections</h2>
        <p className="muted">
          Update the extracted fields, then save, validate, or reject the
          document.
        </p>

        <form action={saveReviewAction}>
          <input name="documentId" type="hidden" value={document.id} />
          <div className="form-grid">
            <div className="field-stack">
              <label htmlFor="documentType">Document type</label>
              <select
                defaultValue={activeData.documentType}
                id="documentType"
                name="documentType"
              >
                <option value="unknown">Unknown</option>
                <option value="invoice">Invoice</option>
                <option value="purchase_order">Purchase order</option>
              </select>
            </div>
            <div className="field-stack">
              <label htmlFor="supplierName">Supplier / company</label>
              <input
                defaultValue={activeData.supplierName ?? ""}
                id="supplierName"
                name="supplierName"
              />
            </div>
            <div className="field-stack">
              <label htmlFor="documentNumber">Document number</label>
              <input
                defaultValue={activeData.documentNumber ?? ""}
                id="documentNumber"
                name="documentNumber"
              />
            </div>
            <div className="field-stack">
              <label htmlFor="issueDate">Issue date</label>
              <input
                defaultValue={activeData.issueDate ?? ""}
                id="issueDate"
                name="issueDate"
                placeholder="YYYY-MM-DD"
              />
            </div>
            <div className="field-stack">
              <label htmlFor="dueDate">Due date</label>
              <input
                defaultValue={activeData.dueDate ?? ""}
                id="dueDate"
                name="dueDate"
                placeholder="YYYY-MM-DD"
              />
            </div>
            <div className="field-stack">
              <label htmlFor="currency">Currency</label>
              <input
                defaultValue={activeData.currency ?? ""}
                id="currency"
                name="currency"
              />
            </div>
            <div className="field-stack">
              <label htmlFor="subtotal">Subtotal</label>
              <input
                defaultValue={activeData.subtotal ?? ""}
                id="subtotal"
                name="subtotal"
              />
            </div>
            <div className="field-stack">
              <label htmlFor="tax">Tax</label>
              <input defaultValue={activeData.tax ?? ""} id="tax" name="tax" />
            </div>
            <div className="field-stack">
              <label htmlFor="total">Total</label>
              <input defaultValue={activeData.total ?? ""} id="total" name="total" />
            </div>
          </div>

          <div className="field-stack" style={{ marginTop: "1rem" }}>
            <label htmlFor="lineItems">Line items</label>
            <textarea
              defaultValue={serializeLineItemsEditorText(activeData.lineItems)}
              id="lineItems"
              name="lineItems"
            />
            <p className="muted" style={{ margin: 0 }}>
              One line per item in the format: description | qty | unit price |
              total
            </p>
          </div>

          <div className="button-row" style={{ marginTop: "1rem" }}>
            <button
              className="button-secondary"
              name="reviewAction"
              type="submit"
              value="save"
            >
              Save corrections
            </button>
            <button
              className="button"
              name="reviewAction"
              type="submit"
              value="validate"
            >
              Mark validated
            </button>
            <button
              className="button-secondary"
              name="reviewAction"
              style={{ borderColor: "var(--danger-border)", color: "var(--danger)" }}
              type="submit"
              value="reject"
            >
              Reject document
            </button>
          </div>
        </form>
      </section>

      <section className="details-grid">
        <article className="panel">
          <h2>Raw extracted text</h2>
          <pre className="code-block">
            {document.rawText || "No raw text was captured for this document."}
          </pre>
        </article>

        <article className="panel">
          <h2>Review history</h2>
          {reviewEvents.length > 0 ? (
            <ul className="history-list">
              {reviewEvents.map((event) => (
                <li className="history-item" key={event.id}>
                  <strong>{event.action}</strong>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {event.created_at}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No review actions recorded yet.</p>
          )}
        </article>
      </section>
    </main>
  );
}
