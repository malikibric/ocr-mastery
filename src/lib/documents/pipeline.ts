import fs from "node:fs/promises";
import path from "node:path";
import { createEmptyExtractedData } from "@/lib/documents/defaults";
import {
  detectUploadedDocumentType,
  getFileExtension,
  getMimeType,
  isSupportedDocument,
  MAX_UPLOAD_BYTES
} from "@/lib/documents/file-types";
import {
  extractCroppedImageText,
  extractImageLayout,
  extractRawText
} from "@/lib/documents/extraction";
import {
  detectStructuredImageLayoutDocumentCount,
  splitImageOcrLayoutIntoBlocks,
  type ImageOcrLayout
} from "@/lib/documents/image-layout";
import { parseExtractedDocument, splitDocumentBlocks } from "@/lib/documents/parsing";
import { validateExtractedData } from "@/lib/documents/validation";
import { logStructuredError } from "@/lib/logging";
import {
  deleteDatasetDocumentsBySourcePathExcept,
  getUploadDirectory,
  saveProcessedDocument,
  withDocumentNumberTransaction
} from "@/lib/database";
import type {
  ExtractedDocumentData,
  DocumentStatus,
  PersistedDocument,
  SourceType,
  ValidationIssue
} from "@/lib/documents/types";

function getInitialStatus(hasErrors: boolean): DocumentStatus {
  return hasErrors ? "needs_review" : "uploaded";
}

function buildProcessingErrorIssue(message: string): ValidationIssue[] {
  return [
    {
      code: "processing-failed",
      message,
      severity: "error",
      field: "document"
    }
  ];
}

type ParsedDocumentInput = {
  id?: string;
  sourceName: string;
  sourceType: SourceType;
  mimeType: string;
  fileExtension: string;
  sourcePath: string;
  rawText: string;
  extractedData: ExtractedDocumentData;
};

type RawDocumentInput = {
  id?: string;
  sourceName: string;
  sourceType: SourceType;
  mimeType: string;
  fileExtension: string;
  sourcePath: string;
  rawText: string;
};

async function validateAndSaveProcessedDocument(input: ParsedDocumentInput) {
  return withDocumentNumberTransaction(
    input.extractedData.documentNumber,
    async (queryable) => {
      const validationIssues = await validateExtractedData(
        input.extractedData,
        input.id,
        queryable
      );
      const hasErrors = validationIssues.some((issue) => issue.severity === "error");

      return saveProcessedDocument(
        {
          id: input.id,
          sourceName: input.sourceName,
          sourceType: input.sourceType,
          mimeType: input.mimeType,
          fileExtension: input.fileExtension,
          sourcePath: input.sourcePath,
          rawText: input.rawText,
          extractedData: input.extractedData,
          validationIssues,
          status: getInitialStatus(hasErrors)
        },
        queryable
      );
    }
  );
}

async function saveProcessingFailure(
  input: Omit<RawDocumentInput, "rawText"> & {
    rawText?: string;
  },
  message: string
) {
  logStructuredError("document-processing-failed", new Error(message), {
    documentId: input.id ?? null,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    sourcePath: input.sourcePath
  });

  try {
    return await saveProcessedDocument({
      id: input.id,
      sourceName: input.sourceName,
      sourceType: input.sourceType,
      mimeType: input.mimeType,
      fileExtension: input.fileExtension,
      sourcePath: input.sourcePath,
      rawText: input.rawText ?? "",
      extractedData: createEmptyExtractedData(),
      validationIssues: buildProcessingErrorIssue(message),
      status: "needs_review",
      processingError: message
    });
  } catch {
    return null;
  }
}

function scoreExtractedData(extractedData: ExtractedDocumentData) {
  let score = 0;

  if (extractedData.documentType !== "unknown") {
    score += 2;
  }

  if (extractedData.supplierName) {
    score += 2;
  }

  if (extractedData.documentNumber) {
    score += 2;
  }

  if (extractedData.issueDate) {
    score += 1;
  }

  if (extractedData.dueDate) {
    score += 1;
  }

  if (extractedData.currency) {
    score += 1;
  }

  if (
    extractedData.subtotal !== null ||
    extractedData.tax !== null ||
    extractedData.total !== null
  ) {
    score += 1;
  }

  if (extractedData.lineItems.length > 0) {
    score += 1;
  }

  return score;
}

function scoreParsedDocumentCandidate(
  block: string,
  extractedData: ExtractedDocumentData
) {
  let identitySignals = 0;

  if (/\b(?:tax|proforma)\s+invoice\b|\binvoice\b|\bpurchase[\s_-]?order\b|\bcompany details\b/i.test(block)) {
    identitySignals += 1;
  }

  if (extractedData.documentType !== "unknown") {
    identitySignals += 1;
  }

  if (extractedData.supplierName) {
    identitySignals += 1;
  }

  if (extractedData.documentNumber) {
    identitySignals += 1;
  }

  return {
    score: scoreExtractedData(extractedData) + (identitySignals > 0 ? 2 : 0),
    identitySignals
  };
}

function scoreRawTextCandidate(fileName: string, fileExtension: string, text: string) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return {
      score: -1,
      identitySignals: 0
    };
  }

  const extractedData = parseExtractedDocument(fileName, fileExtension, normalizedText);
  const baseScore = scoreParsedDocumentCandidate(normalizedText, extractedData);

  return {
    score:
      baseScore.score +
      Math.min(2, normalizedText.length / 500) +
      (extractedData.total !== null ? 1 : 0),
    identitySignals: baseScore.identitySignals
  };
}

function isUsableStructuredImageBlock(
  fileName: string,
  fileExtension: string,
  text: string
) {
  const normalizedText = text.trim();

  if (normalizedText.length < 80) {
    return false;
  }

  const extractedData = parseExtractedDocument(fileName, fileExtension, normalizedText);

  if (extractedData.documentType === "unknown" || !extractedData.supplierName) {
    return false;
  }

  return (
    extractedData.documentNumber !== null ||
    extractedData.issueDate !== null ||
    extractedData.total !== null ||
    extractedData.subtotal !== null ||
    scoreRawTextCandidate(fileName, fileExtension, normalizedText).score >= 6
  );
}

function isScreenshotSource(sourceName: string) {
  return /\bscreenshot\b/i.test(sourceName);
}

function hasUsableStructuredImageBlocks(
  sourceName: string,
  fileExtension: string,
  blocks: string[]
) {
  const normalizedBlocks = blocks.map((block) => block.trim()).filter(Boolean);

  return (
    normalizedBlocks.length === 3 &&
    normalizedBlocks.every((block) =>
      isUsableStructuredImageBlock(sourceName, fileExtension, block)
    )
  );
}

function getStructuredThreeDocumentTemplateBoxes(width: number, height: number) {
  return [
    {
      x0: Math.round(width * 0.061),
      y0: Math.round(height * 0.042),
      x1: Math.round(width * 0.423),
      y1: Math.round(height * 0.535)
    },
    {
      x0: Math.round(width * 0.545),
      y0: Math.round(height * 0.07),
      x1: Math.round(width * 0.94),
      y1: Math.round(height * 0.65)
    },
    {
      x0: Math.round(width * 0.315),
      y0: Math.round(height * 0.465),
      x1: Math.round(width * 0.735),
      y1: Math.round(height * 0.965)
    }
  ];
}

function selectBestTextFromCandidates(
  sourceName: string,
  fileExtension: string,
  candidates: string[]
) {
  const uniqueCandidates = [...new Set(candidates.map((candidate) => candidate.trim()))].filter(
    Boolean
  );

  if (uniqueCandidates.length === 0) {
    return "";
  }

  const scoredCandidates = uniqueCandidates.map((candidate) => ({
    candidate,
    ...scoreRawTextCandidate(sourceName, fileExtension, candidate)
  }));

  scoredCandidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.identitySignals !== left.identitySignals) {
      return right.identitySignals - left.identitySignals;
    }

    return right.candidate.length - left.candidate.length;
  });

  return scoredCandidates[0]?.candidate ?? "";
}

async function extractStructuredTemplateImageTexts(
  sourceName: string,
  fileExtension: string,
  filePath: string,
  width: number,
  height: number
) {
  const templateBoxes = getStructuredThreeDocumentTemplateBoxes(width, height);
  const preferredPsmOrders = [
    [11, 6, 4],
    [11, 4, 6],
    [6, 11, 4]
  ];

  return Promise.all(
    templateBoxes.map(async (bbox, index) => {
      const candidates: string[] = [];

      for (const psm of preferredPsmOrders[index] ?? [6, 11, 4]) {
        const candidate = await extractCroppedImageText(filePath, bbox, {
            paddingRatio: 0.04,
            minimumPadding: 12,
            psm
          }).catch(() => "");

        candidates.push(candidate);

        const extractedData = parseExtractedDocument(sourceName, fileExtension, candidate);
        if (extractedData.documentType !== "unknown" && extractedData.supplierName) {
          return candidate.trim();
        }
      }

      return selectBestTextFromCandidates(sourceName, fileExtension, candidates);
    })
  );
}

export function shouldUseImageOcrBlocks(
  fileName: string,
  fileExtension: string,
  blocks: string[]
) {
  if (blocks.length <= 1) {
    return false;
  }

  const viableBlocks = blocks.filter((block) => block.trim().length >= 120);

  if (viableBlocks.length <= 1) {
    return false;
  }

  const qualifyingBlocks = viableBlocks.filter((block) => {
    try {
      const extractedData = parseExtractedDocument(fileName, fileExtension, block);
      const { score, identitySignals } = scoreParsedDocumentCandidate(
        block,
        extractedData
      );
      return score >= 4 && identitySignals >= 1;
    } catch {
      return false;
    }
  });

  return qualifyingBlocks.length >= Math.max(2, Math.ceil(viableBlocks.length * 0.67));
}

export function selectPreferredImageBlockText(
  fileName: string,
  fileExtension: string,
  layoutText: string,
  croppedText: string
) {
  const normalizedLayoutText = layoutText.trim();
  const normalizedCroppedText = croppedText.trim();
  const layoutParsed = parseExtractedDocument(
    fileName,
    fileExtension,
    normalizedLayoutText
  );
  const croppedParsed = parseExtractedDocument(
    fileName,
    fileExtension,
    normalizedCroppedText
  );
  const layoutScore = scoreExtractedData(layoutParsed);
  const croppedScore = scoreExtractedData(croppedParsed);

  if (
    normalizedCroppedText.length >= 60 &&
    normalizedCroppedText.length >= normalizedLayoutText.length * 0.4 &&
    croppedScore > layoutScore
  ) {
    return normalizedCroppedText;
  }

  return normalizedLayoutText;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function buildDatasetDocumentId(fileName: string) {
  return `dataset-${sanitizeFileName(fileName).toLowerCase()}`;
}

function buildSplitDocumentId(
  baseDocumentId: string | undefined,
  index: number
) {
  if (!baseDocumentId) {
    return undefined;
  }

  return index === 0 ? baseDocumentId : `${baseDocumentId}--part-${index + 1}`;
}

function buildSplitSourceName(sourceName: string, index: number, total: number) {
  if (total <= 1) {
    return sourceName;
  }

  return `${sourceName} (${index + 1} of ${total})`;
}

async function extractImageDocumentTexts(
  sourceName: string,
  fileExtension: string,
  filePath: string,
  existingLayout?: ImageOcrLayout
) {
  const layout = existingLayout ?? (await extractImageLayout(filePath));
  const clusteredImageBlocks = splitImageOcrLayoutIntoBlocks(layout);
  const clusteredBlocks = clusteredImageBlocks.map((block) => block.text);
  const structuredLayoutDocumentCount =
    detectStructuredImageLayoutDocumentCount(layout);
  const screenshotSource = isScreenshotSource(sourceName);
  const clusteredBlocksViable = shouldUseImageOcrBlocks(
    sourceName,
    fileExtension,
    clusteredBlocks
  );
  const layoutSuggestsStructuredSplit =
    structuredLayoutDocumentCount >= 3 &&
    clusteredBlocks.length === structuredLayoutDocumentCount;
  const allowGenericClusteredSplit = !screenshotSource && clusteredBlocksViable;
  const canUseClusteredBlocks =
    layoutSuggestsStructuredSplit || allowGenericClusteredSplit;

  if (canUseClusteredBlocks) {
    const clusteredTexts = await Promise.all(
      clusteredImageBlocks.map(async (block) => {
        try {
          const croppedText = await extractCroppedImageText(filePath, block.bbox);
          return selectPreferredImageBlockText(
            sourceName,
            fileExtension,
            block.text,
            croppedText
          );
        } catch (error) {
          logStructuredError("image-block-ocr-failed", error, {
            sourceName,
            sourcePath: filePath,
            bbox: block.bbox
          });
          return block.text;
        }
      })
    );

    if (allowGenericClusteredSplit) {
      return clusteredTexts;
    }

    if (
      layoutSuggestsStructuredSplit &&
      hasUsableStructuredImageBlocks(sourceName, fileExtension, clusteredTexts)
    ) {
      return clusteredTexts;
    }

    if (layoutSuggestsStructuredSplit && clusteredTexts.length === 3) {
      const templateTexts = await extractStructuredTemplateImageTexts(
        sourceName,
        fileExtension,
        filePath,
        layout.width,
        layout.height
      );

      if (hasUsableStructuredImageBlocks(sourceName, fileExtension, templateTexts)) {
        return templateTexts;
      }
    }
  }

  return [await extractRawText(filePath, fileExtension)];
}

export async function processDocumentFile(input: {
  sourceName: string;
  sourceType: SourceType;
  filePath: string;
  documentId?: string;
}) {
  const fileExtension = getFileExtension(input.sourceName);
  const mimeType = getMimeType(input.sourceName);
  const isImage = ["png", "jpg", "jpeg"].includes(fileExtension);

  try {
    const rawTexts = isImage
      ? await extractImageDocumentTexts(
          input.sourceName,
          fileExtension,
          input.filePath
        )
      : [await extractRawText(input.filePath, fileExtension)];
    const blocks = isImage
      ? rawTexts.length > 1
        ? rawTexts
        : rawTexts.flatMap((rawText) => splitDocumentBlocks(rawText))
      : rawTexts;
    const documents = await Promise.all(
      blocks.map((block, index) =>
        processRawDocumentText({
          id: buildSplitDocumentId(input.documentId, index),
          sourceName: buildSplitSourceName(input.sourceName, index, blocks.length),
          sourceType: input.sourceType,
          mimeType,
          fileExtension,
          sourcePath: input.filePath,
          rawText: block
        })
      )
    );
    const persistedDocuments = documents.filter(
      (document): document is PersistedDocument => document !== null
    );

    if (
      input.sourceType === "dataset" &&
      persistedDocuments.length > 0
    ) {
      await deleteDatasetDocumentsBySourcePathExcept(
        input.filePath,
        persistedDocuments.map((document) => document.id)
      );
    }

    return persistedDocuments;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document processing failed.";
    const failedDocument = await saveProcessingFailure(
      {
        id: input.documentId,
        sourceName: input.sourceName,
        sourceType: input.sourceType,
        mimeType,
        fileExtension,
        sourcePath: input.filePath
      },
      message
    );
    return failedDocument ? [failedDocument] : [];
  }
}

export async function importDatasetDocuments(
  onProgress?: (processed: number, failed: number) => void
) {
  const resourcesDirectory = path.join(process.cwd(), "resources");
  const entries = await fs.readdir(resourcesDirectory, { withFileTypes: true });
  const documentFiles = entries
    .filter(
      (entry) => entry.isFile() && isSupportedDocument(entry.name)
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const CONCURRENCY = 2;
  const results = [];
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < documentFiles.length; i += CONCURRENCY) {
    const batch = documentFiles.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (fileName) => {
        const result = await processDocumentFile({
          documentId: buildDatasetDocumentId(fileName),
          sourceName: fileName,
          sourceType: "dataset",
          filePath: path.join(resourcesDirectory, fileName)
        });
        if (result.some((document) => !document.processingError)) processed++;
        else failed++;
        onProgress?.(processed, failed);
        return result;
      })
    );
    results.push(...batchResults);
  }

  return results;
}

async function processRawDocumentText(
  input: RawDocumentInput
): Promise<PersistedDocument | null> {
  try {
    const extractedData = parseExtractedDocument(
      input.sourceName,
      input.fileExtension,
      input.rawText
    );
    return validateAndSaveProcessedDocument({
      id: input.id,
      sourceName: input.sourceName,
      sourceType: input.sourceType,
      mimeType: input.mimeType,
      fileExtension: input.fileExtension,
      sourcePath: input.sourcePath,
      rawText: input.rawText,
      extractedData
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document processing failed.";
    return saveProcessingFailure(input, message);
  }
}

export async function processUploadedFile(
  file: File
): Promise<PersistedDocument[]> {
  const storedFile = await storeUploadedFile(file);
  const { fileExtension, mimeType } = storedFile;
  const isImage = ["png", "jpg", "jpeg"].includes(fileExtension);

  let rawTexts: string[];
  try {
    if (isImage) {
      const layout = await extractImageLayout(storedFile.destination);
      rawTexts = await extractImageDocumentTexts(
        file.name,
        fileExtension,
        storedFile.destination,
        layout
      );
    } else {
      rawTexts = [await extractRawText(storedFile.destination, fileExtension)];
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Text extraction failed.";
    logStructuredError("upload-extraction-failed", error, {
      sourceName: file.name,
      sourcePath: storedFile.destination
    });
    const doc = await saveProcessedDocument({
      sourceName: file.name,
      sourceType: "upload",
      mimeType,
      fileExtension,
      sourcePath: storedFile.destination,
      rawText: "",
      extractedData: createEmptyExtractedData(),
      validationIssues: buildProcessingErrorIssue(message),
      status: "needs_review",
      processingError: message
    }).catch(() => null);
    return doc ? [doc] : [];
  }

  const blocks = isImage
    ? rawTexts.length > 1
      ? rawTexts
      : rawTexts.flatMap((rawText) => splitDocumentBlocks(rawText))
    : rawTexts;
  const multi = blocks.length > 1;

  const results = await Promise.all(
    blocks.map((block, index) => {
      const suffix = multi ? ` (${index + 1} of ${blocks.length})` : "";
      return processRawDocumentText({
        sourceName: `${file.name}${suffix}`,
        sourceType: "upload",
        mimeType,
        fileExtension,
        sourcePath: storedFile.destination,
        rawText: block
      });
    })
  );

  return results.filter((d): d is PersistedDocument => d !== null);
}

export async function storeUploadedFile(file: File) {
  const uploadDirectory = getUploadDirectory();

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Upload exceeds the 10 MB limit.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { fileExtension, mimeType } = await detectUploadedDocumentType(
    file.name,
    bytes
  );
  const storedName = `${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
  const destination = path.join(uploadDirectory, storedName);

  await fs.writeFile(destination, bytes);

  return {
    storedName,
    destination,
    fileExtension,
    mimeType
  };
}
