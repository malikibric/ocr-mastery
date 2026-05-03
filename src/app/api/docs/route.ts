import { NextResponse } from "next/server";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Smart Document Processing System",
    version: "0.1.0",
    description:
      "API for ingesting, extracting, validating, and reviewing business documents."
  },
  servers: [{ url: "/api" }],
  paths: {
    "/documents": {
      get: {
        summary: "List document summaries",
        operationId: "listDocuments",
        responses: {
          "200": {
            description: "Array of document summaries with active data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/DocumentSummary" }
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
            description:
              "Document summary with active data, review history, and a signed file URL",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    document: { $ref: "#/components/schemas/DocumentSummary" },
                    activeData: {
                      $ref: "#/components/schemas/ExtractedDocumentData"
                    },
                    reviewEvents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ReviewEvent" }
                    },
                    fileUrl: { type: "string" }
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
    "/documents/{id}/file": {
      get: {
        summary: "Fetch the original file",
        operationId: "getDocumentFile",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          },
          {
            name: "expires",
            in: "query",
            required: true,
            schema: { type: "string" }
          },
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "200": {
            description: "Original file bytes"
          },
          "403": {
            description: "Missing or invalid signed access token"
          },
          "404": {
            description: "Document or file not found"
          }
        }
      }
    },
    "/documents/import": {
      get: {
        summary: "Read dataset import status",
        operationId: "getImportStatus",
        responses: {
          "200": {
            description: "Current import job state",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ImportState" }
              }
            }
          }
        }
      },
      post: {
        summary: "Import the bundled sample dataset",
        operationId: "importDataset",
        description:
          "Processes all files in the `resources/` directory. Re-importing updates existing records instead of duplicating them.",
        responses: {
          "200": {
            description: "Import was accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    started: { type: "boolean" },
                    total: {
                      type: "integer",
                      description:
                        "Number of supported files discovered in resources/"
                    }
                  }
                }
              }
            }
          },
          "409": {
            description: "An import is already running",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" }
                  }
                }
              }
            }
          }
        }
      },
      delete: {
        summary: "Reset dataset import results",
        operationId: "resetDatasetImport",
        description:
          "Deletes imported dataset records, clears related review history, and resets persisted import state. This can also clear a stale import job that is stuck in the running state.",
        responses: {
          "200": {
            description: "Dataset import state was reset",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    reset: { type: "boolean" },
                    deleted: {
                      type: "integer",
                      description: "Number of dataset documents removed"
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
        enum: ["invoice", "purchase_order", "company_details", "unknown"]
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
          lineItems: {
            type: "array",
            items: { $ref: "#/components/schemas/LineItem" }
          }
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
      DocumentSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          sourceName: { type: "string" },
          sourceType: { type: "string", enum: ["dataset", "upload"] },
          mimeType: { type: "string" },
          fileExtension: { type: "string" },
          status: { $ref: "#/components/schemas/DocumentStatus" },
          validationIssues: {
            type: "array",
            items: { $ref: "#/components/schemas/ValidationIssue" }
          },
          processingError: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          activeData: { $ref: "#/components/schemas/ExtractedDocumentData" }
        }
      },
      ReviewEvent: {
        type: "object",
        properties: {
          id: { type: "integer" },
          action: { type: "string" },
          payload_json: { type: "object" },
          reviewer_email: { type: "string", nullable: true },
          reviewer_name: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" }
        }
      },
      ImportState: {
        type: "object",
        properties: {
          running: { type: "boolean" },
          total: { type: "integer" },
          processed: { type: "integer" },
          failed: { type: "integer" },
          done: { type: "boolean" },
          error: { type: "string", nullable: true }
        }
      }
    }
  }
};

export function GET() {
  return NextResponse.json(spec);
}
