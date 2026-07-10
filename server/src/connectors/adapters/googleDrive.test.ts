import { describe, expect, it } from "vitest";
import { driveFileToRaw, googleDriveConnector, GOOGLE_DOC } from "./googleDrive.js";
import { keepThread } from "../junkFilter.js";

describe("google drive connector", () => {
  it("normalizes a Google document as substantial evidence", () => {
    const raw = driveFileToRaw(
      { id: "doc-1", name: "Access policy", mimeType: GOOGLE_DOC, webViewLink: "https://drive/doc-1", owners: [{ emailAddress: "owner@example.com" }] },
      "A sufficiently detailed process document that explains who can approve production access, what evidence is required, and when the request must stop for security review.",
    );
    expect(raw.source_kind).toBe("document");
    expect(raw.title).toBe("Access policy");
    expect(raw.permalink).toBe("https://drive/doc-1");
    expect(keepThread(raw)).toBe(true);
  });

  it("fetches and truncates document content through the normalized adapter", async () => {
    const adapter = googleDriveConnector({
      async listFiles() {
        return [{ id: "doc-2", name: "Runbook", mimeType: GOOGLE_DOC }];
      },
      async getFileContent() {
        return "x".repeat(12000);
      },
    });
    const result = await adapter.fetch({}, {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].messages[0].text).toHaveLength(10000);
    expect(result.nextCursor).toHaveProperty("modifiedAt");
  });
});
