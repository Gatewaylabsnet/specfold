import type { BodyMode, RequestBody } from "@openapi-collection-studio/core";
import { KeyValueEditor } from "../../components/KeyValueEditor";
import { MultipartFormEditor } from "./MultipartFormEditor";

const bodyModes: Array<{ mode: BodyMode; label: string }> = [
  { mode: "none", label: "None" },
  { mode: "json", label: "JSON" },
  { mode: "raw", label: "Text" },
  { mode: "multipart", label: "Form data" },
  { mode: "form", label: "URL encoded" }
];

export function RequestBodyEditor({
  body,
  onChange
}: {
  body: RequestBody;
  onChange(body: RequestBody): void;
}) {
  const selectMode = (mode: BodyMode) => {
    const next = { ...body, mode };
    if (mode === "json") {
      next.contentType = "application/json";
      next.raw ??= "{}";
    }
    if (mode === "form") {
      next.contentType = "application/x-www-form-urlencoded";
      next.form ??= [];
    }
    if (mode === "multipart") {
      next.contentType = "multipart/form-data";
      next.multipart ??= [];
    }
    onChange(next);
  };

  return (
    <div className="tab-panel">
      <div aria-label="Body type" className="segmented" role="group">
        {bodyModes.map(({ mode, label }) => (
          <button
            aria-pressed={body.mode === mode}
            className={body.mode === mode ? "is-active" : ""}
            key={mode}
            onClick={() => selectMode(mode)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {body.mode === "form" && (
        <KeyValueEditor
          keyPlaceholder="Form field name"
          onChange={(form) => onChange({ ...body, form })}
          valuePlaceholder="Form field value"
          values={body.form ?? []}
        />
      )}

      {body.mode === "multipart" && (
        <MultipartFormEditor
          fields={body.multipart ?? []}
          onChange={(multipart) => onChange({ ...body, multipart })}
        />
      )}

      {body.mode !== "form" && body.mode !== "multipart" && (
        <textarea
          aria-label="Request body"
          className="body-editor"
          disabled={body.mode === "none"}
          onChange={(event) => onChange({ ...body, raw: event.target.value })}
          placeholder={body.mode === "none" ? "Select a body type to add content." : undefined}
          spellCheck={false}
          value={body.raw ?? ""}
        />
      )}
    </div>
  );
}
