export const MAX_INTERVIEW_UPLOADS = 5;
export const MAX_INTERVIEW_FILE_BYTES = 10 * 1024 * 1024;

export type InterviewFileFormat = "pdf" | "docx" | "png" | "jpeg" | "webp";

export interface UploadInput {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

export class UploadValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "UploadValidationError";
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function detectedFormat(bytes: Uint8Array): InterviewFileFormat | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "docx";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (bytes.length >= 12
      && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
      && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

const EXPECTED = {
  pdf: { extensions: [".pdf"], mimes: ["application/pdf"] },
  docx: {
    extensions: [".docx"],
    mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  png: { extensions: [".png"], mimes: ["image/png"] },
  jpeg: { extensions: [".jpg", ".jpeg"], mimes: ["image/jpeg"] },
  webp: { extensions: [".webp"], mimes: ["image/webp"] },
} satisfies Record<InterviewFileFormat, { extensions: string[]; mimes: string[] }>;

export function validateInterviewUpload(
  upload: UploadInput, currentUploadCount: number,
): InterviewFileFormat {
  if (currentUploadCount >= MAX_INTERVIEW_UPLOADS) {
    throw new UploadValidationError("upload_limit_reached");
  }
  if (upload.size <= 0) throw new UploadValidationError("empty_file");
  if (upload.size > MAX_INTERVIEW_FILE_BYTES) {
    throw new UploadValidationError("file_too_large");
  }
  const format = detectedFormat(upload.bytes);
  if (!format) throw new UploadValidationError("unsupported_file_type");
  const expected = EXPECTED[format];
  const lowerName = upload.name.toLowerCase();
  const browserMimeIsGeneric = !upload.type || upload.type === "application/octet-stream";
  if (!expected.extensions.some((extension) => lowerName.endsWith(extension))
      || (!browserMimeIsGeneric && !expected.mimes.includes(upload.type))) {
    throw new UploadValidationError("file_type_mismatch");
  }
  return format;
}
