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

  it("normalizes short-year numeric dates", () => {
    const text = "Invoice No: INV-004\nDate: 12/24/18\nTotal: 100\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.issueDate).toBe("2018-12-24");
  });

  it("extracts compact invoice labels without a space before no", () => {
    const text = "InvoiceNo: WIONZZS\nSupplier: Lowe Supply Co.\nTotal: 100\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.documentNumber).toBe("WIONZZS");
  });

  it("detects currency from $ symbol", () => {
    const text = "Invoice No: INV-005\nGrand Total: $4880\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.currency).toBe("USD");
  });

  it("does not infer currency from unrelated OCR substrings", () => {
    const text = "Tamil Nadu, Code: 33\nDelivery note\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.currency).toBeNull();
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

  it("does not fabricate total from subtotal and tax when no total exists", () => {
    const text = "Invoice No: INV-008\nSub Total: $5400\nTAX 10%: $540\n";
    const result = parseExtractedDocument("invoice.txt", "txt", text);
    expect(result.subtotal).toBe(5400);
    expect(result.tax).toBe(540);
    expect(result.total).toBeNull();
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

  it("extracts company details screenshots from OCR text", () => {
    const text = `
      Company Details
      Organization                             Contact Name                           Contact Email                            Min. rate                                  Created at
      StitchCredit                       Bryan Young                      bryan@stitchcredit.com         $0/mo                             04/30/2020
      Last updated                              Customer Number (MCL)                Implementation Type                    Verification Types                           Portal Access
      04/17/2026                   CIDO0000                    NOT SET
    `;

    const result = parseExtractedDocument("screenshot.png", "png", text);

    expect(result.documentType).toBe("company_details");
    expect(result.supplierName).toBe("StitchCredit");
    expect(result.documentNumber).toBe("CIDO0000");
    expect(result.issueDate).toBe("2026-04-17");
    expect(result.currency).toBeNull();
    expect(result.total).toBeNull();
  });

  it("prefers company-like OCR lines over noisy buyer lines", () => {
    const text = `
      TAX INVOICE
      Sta Name Tom Nach, Coe 33 Buyers
      CARER LUBES ANE. OFF PRIVATE NEPEIN LIMITED Devry ot Dole
      GETWUN DS 12)
    `;

    const result = parseExtractedDocument("screenshot.png", "png", text);

    expect(result.documentType).toBe("invoice");
    expect(result.supplierName).toBe("CARER LUBES ANE. OFF PRIVATE NEPEIN LIMITED");
  });

  it("extracts supplier and INR currency from noisy OCR invoice blocks", () => {
    const text = `
      Aro Indian Rupees To res Thousand Eight Hund rod Thity Fi and Cont Fifty Tax Four paisa Only ve
      STEINS ELECTRIC, INC CONTRACTORS ENGINEERS
      Companys ont are Bark A> oe DATE: re
      Thane INFORMATION SYSTEMS ALA
      sup TOTAL 0m
    `;

    const result = parseExtractedDocument("screenshot.png", "png", text);

    expect(result.supplierName).toBe("STEINS ELECTRIC, INC");
    expect(result.currency).toBe("INR");
    expect(result.total).toBeNull();
  });

  it("prefers the trailing company segment in noisy OCR supplier lines", () => {
    const text = `
      TAX INVOICE
      WGGEOATE LOWE 0 Box 12087 Lowe Supoy Co.
      Total: 100
    `;

    const result = parseExtractedDocument("screenshot.png", "png", text);

    expect(result.supplierName).toBe("Lowe Supoy Co.");
  });

  it("does not infer totals from distant OCR noise after a total label", () => {
    const text = `
      STEINS ELECTRIC, INC CONTRACTORS ENGINEERS
      Aro Indian Rupees To res Thousand Eight Hund rod Thity Fi and Cont Fifty
      sup TOTAL 0m
      T=
      201
      oe Ton er
    `;

    const result = parseExtractedDocument("screenshot.png", "png", text);

    expect(result.total).toBeNull();
  });

  it("extracts invoice number, supplier, and total from short OCR image text", () => {
    const text = `
      Invoice 3872
      Supplier Img 4
      Tota 1062 EUR
    `;

    const result = parseExtractedDocument("img_5.png", "png", text);

    expect(result.documentType).toBe("invoice");
    expect(result.documentNumber).toBe("3872");
    expect(result.supplierName).toBe("Img 4");
    expect(result.currency).toBe("EUR");
    expect(result.total).toBe(1062);
    expect(result.issueDate).toBeNull();
  });

  it("repairs missing OCR decimals in image monetary totals", () => {
    const text = `
      INVOICE
      INVOICE NO. 143999
      INVOICE DATE 28 June 2016
      Total Due: $3960.00
      SUBTOTAL 340000
      VAT 15% 551000
      TOTAL DUE $391000
    `;

    const result = parseExtractedDocument(
      "Screenshot 2026-04-28 at 18.26.27.png",
      "png",
      text
    );

    expect(result.documentNumber).toBe("143999");
    expect(result.subtotal).toBe(3400);
    expect(result.tax).toBe(510);
    expect(result.total).toBe(3910);
  });
});
