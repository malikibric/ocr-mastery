import { NextResponse } from "next/server";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Smart Document Processing System",
    version: "0.1.0",
    description: "API for ingesting, extracting, validating, and reviewing business documents."
  },
  servers: [{ url: "/api" }],
  paths: {
    "/documents": {
      get: {
        summary: "List all documents",
        operationId: "listDocuments",
        responses: {
          "200": {
            description: "Array of all processed documents with their active data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/DocumentWithActiveData" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/documents/{id}": {
      get: {
        summary: "Get a single document",
        operationId: "getDocument",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Document ID"
          }
        ],
        responses: {
          "200": {
            description: "Document detail with active data and review history",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    document: { $ref: "#/components/schemas/Document" },
                    activeData: { $ref: "#/components/schemas/ExtractedDocumentData" },
                    reviewEvents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ReviewEvent" }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Document not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { error: { type: "string" } }
                }
              }
            }
          }
        }
      }
    },
    "/documents/import": {
      post: {
        summary: "Import the bundled sample dataset",
        operationId: "importDataset",
        description: "Processes all files in the `resources/` directory. Re-importing updates existing records instead of duplicating them.",
        responses: {
          "200": {
            description: "Import result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    imported: { type: "integer", description: "Number of files processed" },
                    documentIds: {
                      type: "array",
                      items: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      DocumentStatus: {
        type: "string",
        enum: ["uploaded", "needs_review", "validated", "rejected"]
      },
      DocumentKind: {
        type: "string",
        enum: ["invoice", "purchase_order", "unknown"]
      },
      LineItem: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number", nullable: true },
          unitPrice: { type: "number", nullable: true },
          lineTotal: { type: "number", nullable: true }
        }
      },
      ExtractedDocumentData: {
        type: "object",
        properties: {
          documentType: { $ref: "#/components/schemas/DocumentKind" },
          supplierName: { type: "string", nullable: true },
          documentNumber: { type: "string", nullable: true },
          issueDate: { type: "string", format: "date", nullable: true },
          dueDate: { type: "string", format: "date", nullable: true },
          currency: { type: "string", nullable: true },
          subtotal: { type: "number", nullable: true },
          tax: { type: "number", nullable: true },
          total: { type: "number", nullable: true },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItem" } }
        }
      },
      ValidationIssue: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          severity: { type: "string", enum: ["error", "warning"] },
          field: { type: "string" }
        }
      },
      Document: {
        type: "object",
        properties: {
          id: { type: "string" },
          sourceName: { type: "string" },
          sourceType: { type: "string", enum: ["dataset", "upload"] },
          mimeType: { type: "string" },
          fileExtension: { type: "string" },
          sourcePath: { type: "string" },
          status: { $ref: "#/components/schemas/DocumentStatus" },
          rawText: { type: "string" },
          extractedData: { $ref: "#/components/schemas/ExtractedDocumentData" },
          correctedData: { allOf: [{ $ref: "#/components/schemas/ExtractedDocumentData" }], nullable: true },
          validationIssues: { type: "array", items: { $ref: "#/components/schemas/ValidationIssue" } },
          processingError: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      DocumentWithActiveData: {
        allOf: [
          { $ref: "#/components/schemas/Document" },
          {
            type: "object",
            properties: {
              activeData: { $ref: "#/components/schemas/ExtractedDocumentData" }
            }
          }
        ]
      },
      ReviewEvent: {
        type: "object",
        properties: {
          id: { type: "integer" },
          action: { type: "string" },
          payload_json: { type: "object" },
          created_at: { type: "string", format: "date-time" }
        }
      }
    }
  }
};

export function GET() {
  return NextResponse.json(spec);
}
