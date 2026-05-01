import { describe, it, expect } from "vitest";
import {
  parseExtractedDocument,
  parseNumericInput,
  parseLineItemsEditorText,
  serializeLineItemsEditorText
} from "@/lib/documents/parsing";

describe("parseNumericInput", () => {
  it("parses plain numbers", () => {
    expect(parseNumericInput("1234.56")).toBe(1234.56);
    expect(parseNumericInput("0")).toBe(0);
  });

  it("handles European comma decimals", () => {
    expect(parseNumericInput("1234,56")).toBe(1234.56);
  });

  it("strips currency symbols and spaces", () => {
    expect(parseNumericInput("€ 500.00")).toBe(500);
    expect(parseNumericInput("$1,200.00")).toBe(1200);
  });

  it("returns null for empty or invalid", () => {
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput(null)).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
  });
});

describe("parseLineItemsEditorText", () => {
  it("parses pipe-delimited lines", () => {
    const input = "Widget | 2 | 10.00 | 20.00\nGadget | 1 | 50.00 | 50.00";
    const items = parseLineItemsEditorText(input);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ description: "Widget", quantity: 2, unitPrice: 10, lineTotal: 20 });
    expect(items[1]).toEqual({ description: "Gadget", quantity: 1, unitPrice: 50, lineTotal: 50 });
  });

  it("skips blank lines", () => {
    expect(parseLineItemsEditorText("\n\n")).toHaveLength(0);
  });

  it("falls back to 'Item' for missing description", () => {
    const items = parseLineItemsEditorText("| 1 | 10 | 10");
    expect(items[0].description).toBe("Item");
  });
});

describe("serializeLineItemsEditorText", () => {
  it("round-trips through parseLineItemsEditorText", () => {
    const items = [
      { description: "Widget", quantity: 2, unitPrice: 10, lineTotal: 20 },
      { description: "Gadget", quantity: 1, unitPrice: 50, lineTotal: 50 }
    ];
    const serialized = serializeLineItemsEditorText(items);
    const reparsed = parseLineItemsEditorText(serialized);

    expect(reparsed).toHaveLength(2);
    expect(reparsed[0]).toEqual(items[0]);
    expect(reparsed[1]).toEqual(items[1]);
  });
});

describe("parseExtractedDocument — CSV", () => {
  const csvText = `desc,qty,price,total\nWidget,2,10.00,20.00\nGadget,1,50.00,50.00\n`;

  it("parses line items from CSV headers", () => {
    const result = parseExtractedDocument("data_1.csv", "csv", csvText);
    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[0].description).toBe("Widget");
    expect(result.lineItems[0].quantity).toBe(2);
    expect(result.lineItems[0].lineTotal).toBe(20);
  });

  it("computes subtotal and total from line items", () => {
    const result = parseExtractedDocument("data_1.csv", "csv", csvText);
    expect(result.subtotal).toBe(70);
    expect(result.total).toBe(70);
  });

  it("detects invoice type from filename", () => {
    const result = parseExtractedDocument("invoice_1.csv", "csv", csvText);
    expect(result.documentType).toBe("invoice");
  });

  it("detects purchase_order type from filename", () => {
    const result = parseExtractedDocument("po_1.csv", "csv", "desc,qty,price,total\nItem,1,10,10\n");
    expect(result.documentType).toBe("purchase_order");
  });
});

describe("parseExtractedDocument — TXT/generic", () => {
  const txtText = `
    Invoice Number: INV-001
    Supplier: Acme Corp
    Date: 2024-01-15
    Due Date: 2024-02-15
    Currency: EUR
    Subtotal: 100.00
    Tax: 20.00
    Total: 120.00
  `;

  it("extracts document number", () => {
    const result = parseExtractedDocument("invoice.txt", "txt", txtText);
    expect(result.documentNumber).toBe("INV-001");
  });

  it("extracts supplier name", () => {
    const result = parseExtractedDocument("invoice.txt", "txt", txtText);
    expect(result.supplierName).toBe("Acme Corp");
  });

  it("extracts and normalizes ISO date", () => {
    const result = parseExtractedDocument("invoice.txt", "txt", txtText);
    expect(result.issueDate).toBe("2024-01-15");
  });

  it("extracts currency", () => {
    const result = parseExtractedDocument("invoice.txt", "txt", txtText);
    expect(result.currency).toBe("EUR");
  });

  it("extracts numeric totals", () => {
    const result = parseExtractedDocument("invoice.txt", "txt", txtText);
    expect(result.subtotal).toBe(100);
    expect(result.tax).toBe(20);
    expect(result.total).toBe(120);
  });

  it("normalizes European dates (DD.MM.YYYY → YYYY-MM-DD)", () => {
    const text = "Invoice Number: INV-002\nDate: 15.01.2024\nTotal: 50.00\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.issueDate).toBe("2024-01-15");
  });

  it("normalizes text month dates (15 March 2026 → 2026-03-15)", () => {
    const text = "Invoice No: INV-003\nDue Date: 15 March 2026\nTotal: 100\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.dueDate).toBe("2026-03-15");
  });

  it("normalizes text month dates (March 15, 2026 → 2026-03-15)", () => {
    const text = "Invoice No: INV-004\nDate: March 15, 2026\nTotal: 100\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.issueDate).toBe("2026-03-15");
  });

  it("detects currency from $ symbol", () => {
    const text = "Invoice No: INV-005\nGrand Total: $4880\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.currency).toBe("USD");
  });

  it("extracts Sub Total with space", () => {
    const text = "Invoice No: INV-006\nSub Total: $5400\nGrand Total: $5940\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.subtotal).toBe(5400);
  });

  it("extracts Grand Total correctly", () => {
    const text = "Invoice No: INV-007\nSub Total: $5400\nTAX 10%: $540\nGrand Total: $4880\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.total).toBe(4880);
  });

  it("extracts tax amount not percentage", () => {
    const text = "Invoice No: INV-008\nSub Total: $5400\nTAX 10%: $540\nGrand Total: $5940\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.tax).toBe(540);
  });

  it("extracts company name by Ltd. suffix", () => {
    const text = "Invoice No: INV-009\nCompany Name, Ltd.\nGrand Total: $100\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.supplierName).toBe("Company Name, Ltd.");
  });

  it("returns unknown type for unrecognized text", () => {
    const result = parseExtractedDocument("mystery.txt", "txt", "some random text Total: 5");
    expect(result.documentType).toBe("unknown");
  });
});
