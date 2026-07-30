import { describe, expect, it } from "vitest";
import {
  validateExportPayload,
  validateIpcSettings,
  validateIpcWorkspace,
  validateSendRequestPayload,
  validateUploadId,
  validateUrl
} from "./ipcValidation";

describe("IPC payload validation", () => {
  it("accepts supported workspace and settings shapes", () => {
    expect(validateIpcWorkspace({
      schemaVersion: 1,
      collections: [],
      environments: []
    }).schemaVersion).toBe(1);
    expect(validateIpcSettings({
      requestTimeoutMs: 30_000,
      maxResponseBytes: 1024,
      allowInsecureTls: false,
      theme: "system",
      fontSize: "compact"
    }).theme).toBe("system");
  });

  it("rejects malformed structured payloads", () => {
    expect(() => validateIpcWorkspace({ schemaVersion: 1 })).toThrow("Invalid workspace");
    expect(() => validateIpcSettings({
      requestTimeoutMs: Number.NaN,
      maxResponseBytes: 1024,
      allowInsecureTls: false,
      theme: "system",
      fontSize: "compact"
    })).toThrow("Invalid settings");
    expect(() => validateSendRequestPayload({ request: null })).toThrow("Invalid request");
  });

  it("bounds strings crossing the IPC boundary", () => {
    expect(validateUrl("https://example.com")).toBe("https://example.com");
    expect(validateUploadId("upload-1")).toBe("upload-1");
    expect(validateExportPayload({ defaultPath: "api.yaml", content: "openapi: 3.1.0" }))
      .toEqual({ defaultPath: "api.yaml", content: "openapi: 3.1.0" });
    expect(() => validateUrl("")).toThrow("Invalid URL");
    expect(() => validateUploadId("x".repeat(129))).toThrow("Invalid upload");
    expect(() => validateExportPayload({ defaultPath: "", content: "" }))
      .toThrow("Invalid export");
  });
});
