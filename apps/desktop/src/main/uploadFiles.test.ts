import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MultipartField } from "@openapi-collection-studio/core";
import {
  MAX_MULTIPART_FILE_COUNT,
  clearUploadFiles,
  createMultipartFormData,
  registerUploadFile,
  retainUploadFiles,
  stripMultipartTransportHeaders
} from "./uploadFiles";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  clearUploadFiles();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "specfold-upload-"));
  temporaryDirectories.push(path);
  return path;
}

function textField(id: string, key: string, value: string): MultipartField {
  return { id, key, value, type: "text", enabled: true };
}

function fileField(id: string, key: string, uploadId?: string): MultipartField {
  return { id, key, value: "", type: "file", enabled: true, uploadId };
}

describe("session upload files", () => {
  it("builds text and binary file parts and lets fetch generate the matching boundary", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "report.bin");
    const bytes = Buffer.from([0, 1, 2, 255, 10, 20]);
    await writeFile(filePath, bytes);
    const selected = await registerUploadFile(filePath, 7);

    const { formData, sizeBytes } = await createMultipartFormData([
      textField("title", "title", "Quarterly report"),
      { ...fileField("document", "document", selected.uploadId), contentType: "application/octet-stream" }
    ], 7);
    const request = new Request("https://example.test/upload", { method: "POST", body: formData });
    const contentType = request.headers.get("content-type") ?? "";
    const boundary = /boundary=(.+)$/i.exec(contentType)?.[1];
    const encoded = Buffer.from(await request.arrayBuffer());

    expect(selected).toMatchObject({
      fileName: "report.bin",
      sizeBytes: bytes.byteLength,
      contentType: "application/octet-stream"
    });
    expect(selected).not.toHaveProperty("canonicalPath");
    expect(sizeBytes).toBe(Buffer.byteLength("Quarterly report") + bytes.byteLength);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/i);
    expect(boundary).toBeTruthy();
    expect(encoded.includes(Buffer.from(`--${boundary}`))).toBe(true);
    expect(encoded.includes(Buffer.from('name="title"'))).toBe(true);
    expect(encoded.includes(Buffer.from("Quarterly report"))).toBe(true);
    expect(encoded.includes(Buffer.from('name="document"; filename="report.bin"'))).toBe(true);
    expect(encoded.includes(bytes)).toBe(true);
  });

  it("rejects fake, expired, and cross-owner upload ids", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "private.txt");
    await writeFile(filePath, "private", "utf8");
    const selected = await registerUploadFile(filePath, 10);

    await expect(
      createMultipartFormData([fileField("fake", "file", "not-a-real-token")], 10)
    ).rejects.toThrow(/unavailable or expired/i);
    await expect(
      createMultipartFormData([fileField("owner", "file", selected.uploadId)], 11)
    ).rejects.toThrow(/unavailable or expired/i);

    clearUploadFiles(10);
    await expect(
      createMultipartFormData([fileField("expired", "file", selected.uploadId)], 10)
    ).rejects.toThrow(/unavailable or expired/i);
  });

  it("releases grants no longer referenced by the live owner workspace", async () => {
    const directory = await temporaryDirectory();
    const firstPath = join(directory, "first.txt");
    const secondPath = join(directory, "second.txt");
    await writeFile(firstPath, "first", "utf8");
    await writeFile(secondPath, "second", "utf8");
    const first = await registerUploadFile(firstPath, 12);
    const second = await registerUploadFile(secondPath, 12);

    retainUploadFiles(12, new Set([first.uploadId, second.uploadId]));
    retainUploadFiles(12, new Set([second.uploadId]));

    await expect(
      createMultipartFormData([fileField("first", "file", first.uploadId)], 12)
    ).rejects.toThrow(/unavailable or expired/i);
    await expect(
      createMultipartFormData([fileField("second", "file", second.uploadId)], 12)
    ).resolves.toMatchObject({ sizeBytes: 6 });
  });

  it("rejects a file deleted after explicit selection", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "temporary.txt");
    await writeFile(filePath, "delete me", "utf8");
    const selected = await registerUploadFile(filePath, 20);
    await unlink(filePath);

    await expect(
      createMultipartFormData([fileField("deleted", "file", selected.uploadId)], 20)
    ).rejects.toThrow(/no longer exists/i);
  });

  it("rejects a file changed after selection", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "mutable.txt");
    await writeFile(filePath, "before", "utf8");
    const selected = await registerUploadFile(filePath, 30);
    await writeFile(filePath, "after-change", "utf8");

    await expect(
      createMultipartFormData([fileField("changed", "file", selected.uploadId)], 30)
    ).rejects.toThrow(/changed after selection/i);
  });

  it("does not register symbolic links as upload files", async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, "target.txt");
    const linked = join(directory, "linked.txt");
    await writeFile(target, "target", "utf8");
    try {
      await symlink(target, linked, "file");
    } catch (error) {
      if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    await expect(registerUploadFile(linked, 35)).rejects.toThrow(/symbolic links/i);
  });

  it("enforces the 100 MB aggregate limit before opening file blobs", async () => {
    const directory = await temporaryDirectory();
    const firstPath = join(directory, "first.bin");
    const secondPath = join(directory, "second.bin");
    await writeFile(firstPath, "", "utf8");
    await writeFile(secondPath, "", "utf8");
    await truncate(firstPath, 60 * 1024 * 1024);
    await truncate(secondPath, 60 * 1024 * 1024);
    const first = await registerUploadFile(firstPath, 40);
    const second = await registerUploadFile(secondPath, 40);

    await expect(createMultipartFormData([
      fileField("first", "files", first.uploadId),
      fileField("second", "files", second.uploadId)
    ], 40)).rejects.toThrow(/larger than the 100 MB upload limit/i);
  });

  it("enforces the 50-file request limit", async () => {
    const fields = Array.from({ length: MAX_MULTIPART_FILE_COUNT + 1 }, (_, index) =>
      fileField(`file-${index}`, "files", `token-${index}`)
    );
    await expect(createMultipartFormData(fields, 50)).rejects.toThrow(/at most 50 files/i);
  });

  it("rejects malformed text values received across IPC", async () => {
    const malformed = {
      ...textField("title", "title", "valid"),
      value: { nested: "not text" }
    } as unknown as MultipartField;

    await expect(createMultipartFormData([malformed], 55)).rejects.toThrow(/invalid value/i);
  });

  it("removes manual content framing headers without changing other headers", () => {
    expect(stripMultipartTransportHeaders({
      "content-type": "multipart/form-data; boundary=wrong",
      "Content-Length": "123",
      Accept: "application/json"
    })).toEqual({ Accept: "application/json" });
  });
});
