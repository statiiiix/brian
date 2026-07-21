// pdf-parse and mammoth are imported lazily, inside the extractor that needs
// them. pdf-parse bundles pdf.js, which throws `DOMMatrix is not defined` while
// the module evaluates on the Supabase Edge runtime (no native canvas binding,
// no DOM globals). A static import therefore kills the whole worker at boot,
// not just PDF uploads — it passes under Node and fails only in production.
import { Buffer } from "node:buffer";
import type { ImageAnalyzer } from "../llm/images.js";
import type { InterviewFileFormat } from "./uploads.js";

export const MAX_EXTRACTED_CHARS = 60_000;

export interface ExtractionInput {
  format: InterviewFileFormat;
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

interface ExtractorDependencies {
  pdfText?: (bytes: Uint8Array) => Promise<string>;
  docxText?: (bytes: Uint8Array) => Promise<string>;
  imageAnalyzer: ImageAnalyzer;
}

async function defaultPdfText(bytes: Uint8Array): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

async function defaultDocxText(bytes: Uint8Array): Promise<string> {
  const { default: mammoth } = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

export async function extractInterviewFile(
  input: ExtractionInput, dependencies: ExtractorDependencies,
): Promise<string> {
  let text: string;
  if (input.format === "pdf") {
    text = await (dependencies.pdfText ?? defaultPdfText)(input.bytes);
  } else if (input.format === "docx") {
    text = await (dependencies.docxText ?? defaultDocxText)(input.bytes);
  } else {
    text = await dependencies.imageAnalyzer.analyze({
      bytes: input.bytes, mimeType: input.mimeType, filename: input.filename,
    });
  }
  const normalized = text.trim();
  if (!normalized) throw new Error("no readable content");
  return normalized.slice(0, MAX_EXTRACTED_CHARS);
}
