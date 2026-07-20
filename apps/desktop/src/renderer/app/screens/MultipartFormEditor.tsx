import { FilePlus2, Plus, Trash2, X } from "lucide-react";
import {
  createMultipartField,
  type MultipartField,
  type MultipartFieldType
} from "@openapi-collection-studio/core";
import { useState } from "react";

export function MultipartFormEditor({
  fields,
  onChange
}: {
  fields: MultipartField[];
  onChange(fields: MultipartField[]): void;
}) {
  const [pickerErrors, setPickerErrors] = useState<Record<string, string>>({});

  const update = (id: string, recipe: (field: MultipartField) => MultipartField) => {
    onChange(fields.map((field) => (field.id === id ? recipe(field) : field)));
  };

  const setType = (field: MultipartField, type: MultipartFieldType) => {
    setPickerErrors((current) => withoutKey(current, field.id));
    if (field.uploadId) {
      releaseUpload(field.uploadId);
    }
    update(field.id, (current) => ({
      ...current,
      type,
      value: type === "text" ? current.value : "",
      uploadId: undefined,
      fileName: undefined,
      contentType: undefined,
      sizeBytes: undefined
    }));
  };

  const chooseFile = async (field: MultipartField) => {
    setPickerErrors((current) => withoutKey(current, field.id));
    try {
      const result = await window.studio.openUploadFile();
      if (result.canceled) {
        return;
      }
      if (result.error || !result.file) {
        setPickerErrors((current) => ({
          ...current,
          [field.id]: result.error ?? "The selected file could not be opened."
        }));
        return;
      }
      if (field.uploadId && field.uploadId !== result.file.uploadId) {
        releaseUpload(field.uploadId);
      }
      update(field.id, (current) => ({
        ...current,
        type: "file",
        value: "",
        uploadId: result.file?.uploadId,
        fileName: result.file?.fileName,
        contentType: result.file?.contentType,
        sizeBytes: result.file?.sizeBytes
      }));
    } catch (error) {
      setPickerErrors((current) => ({
        ...current,
        [field.id]: error instanceof Error ? error.message : "The file picker could not be opened."
      }));
    }
  };

  const clearFile = (field: MultipartField) => {
    setPickerErrors((current) => withoutKey(current, field.id));
    if (field.uploadId) {
      releaseUpload(field.uploadId);
    }
    update(field.id, (current) => ({
      ...current,
      uploadId: undefined,
      fileName: undefined,
      contentType: undefined,
      sizeBytes: undefined
    }));
  };

  return (
    <div className="multipart-editor">
      <div aria-label="Multipart boundary information" className="multipart-editor__help" role="note">
        <strong>Text fields and files can be sent together.</strong>
        <span>Specfold creates the multipart boundary and Content-Type header automatically.</span>
      </div>

      {fields.length === 0 && (
        <div className="multipart-editor__empty">
          <strong>No form-data fields yet</strong>
          <span>Add a text field or a file to build the request body.</span>
        </div>
      )}

      <div aria-label="Form-data fields" className="multipart-editor__fields" role="list">
        {fields.map((field, index) => {
          const missingFile = field.enabled && field.type === "file" && !field.uploadId;
          const pickerError = pickerErrors[field.id];
          const error = pickerError ?? (missingFile
            ? field.fileName
              ? `Select ${field.fileName} again before sending.`
              : "Choose a file before sending."
            : undefined);

          return (
            <div
              aria-label={`Form-data field ${index + 1}`}
              className={`multipart-field${field.enabled ? "" : " is-disabled"}`}
              key={field.id}
              role="listitem"
            >
              <div className="multipart-field__header">
                <label className="multipart-field__enabled">
                  <input
                    aria-label={`Field ${index + 1} enabled`}
                    checked={field.enabled}
                    onChange={(event) =>
                      update(field.id, (current) => ({ ...current, enabled: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>Enabled</span>
                </label>
                <label className="multipart-field__name">
                  <span>Field name</span>
                  <input
                    aria-label={`Field ${index + 1} name`}
                    onChange={(event) =>
                      update(field.id, (current) => ({ ...current, key: event.target.value }))
                    }
                    placeholder="e.g. document"
                    value={field.key}
                  />
                </label>
                <label className="multipart-field__type">
                  <span>Type</span>
                  <select
                    aria-label={`Field ${index + 1} type`}
                    onChange={(event) => setType(field, event.target.value as MultipartFieldType)}
                    value={field.type}
                  >
                    <option value="text">Text</option>
                    <option value="file">File</option>
                  </select>
                </label>
                <button
                  aria-label={`Remove field ${index + 1}`}
                  className="icon-button multipart-field__remove"
                  onClick={() => {
                    setPickerErrors((current) => withoutKey(current, field.id));
                    if (field.uploadId) {
                      releaseUpload(field.uploadId);
                    }
                    onChange(fields.filter((candidate) => candidate.id !== field.id));
                  }}
                  title="Remove field"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {field.type === "text" ? (
                <label className="multipart-field__value">
                  <span>Value</span>
                  <input
                    aria-label={`Field ${index + 1} value`}
                    disabled={!field.enabled}
                    onChange={(event) =>
                      update(field.id, (current) => ({ ...current, value: event.target.value }))
                    }
                    placeholder="Text value or {{variable}}"
                    value={field.value}
                  />
                </label>
              ) : (
                <>
                  <div className="multipart-field__file">
                    <div className="multipart-field__file-copy" aria-live="polite">
                      <span>File</span>
                      {field.uploadId && field.fileName ? (
                        <>
                          <strong title={field.fileName}>{field.fileName}</strong>
                          <small>{fileDetails(field)}</small>
                        </>
                      ) : (
                        <small>{field.fileName ? `Expected file: ${field.fileName}` : "No file selected"}</small>
                      )}
                    </div>
                    <div className="multipart-field__file-actions">
                      <button
                        aria-label={`${field.uploadId ? "Replace" : "Choose"} file for field ${index + 1}`}
                        className="secondary-button"
                        disabled={!field.enabled}
                        onClick={() => void chooseFile(field)}
                        type="button"
                      >
                        <FilePlus2 size={15} />
                        {field.uploadId ? "Replace file" : "Choose file"}
                      </button>
                      {field.uploadId && (
                        <button
                          aria-label={`Clear file for field ${index + 1}`}
                          className="text-button"
                          onClick={() => clearFile(field)}
                          type="button"
                        >
                          <X size={14} />
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <label className="multipart-field__media-type">
                    <span>Media type (optional)</span>
                    <input
                      aria-label={`Field ${index + 1} media type`}
                      disabled={!field.enabled}
                      onChange={(event) =>
                        update(field.id, (current) => ({
                          ...current,
                          contentType: event.target.value || undefined
                        }))
                      }
                      placeholder="application/octet-stream"
                      value={field.contentType ?? ""}
                    />
                  </label>
                </>
              )}

              {error && (
                <p className="multipart-field__error" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="multipart-editor__actions">
        <button
          className="secondary-button"
          onClick={() => onChange([...fields, createMultipartField("text")])}
          type="button"
        >
          <Plus size={16} />
          Add text field
        </button>
        <button
          className="secondary-button"
          onClick={() => onChange([...fields, createMultipartField("file")])}
          type="button"
        >
          <FilePlus2 size={16} />
          Add file
        </button>
      </div>
    </div>
  );
}

function withoutKey(values: Record<string, string>, key: string): Record<string, string> {
  if (!(key in values)) {
    return values;
  }
  const next = { ...values };
  delete next[key];
  return next;
}

function fileDetails(field: MultipartField): string {
  return [
    field.sizeBytes === undefined ? undefined : formatBytes(field.sizeBytes),
    field.contentType
  ].filter(Boolean).join(" / ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function releaseUpload(uploadId: string): void {
  void window.studio.releaseUploadFile(uploadId).catch(() => undefined);
}
