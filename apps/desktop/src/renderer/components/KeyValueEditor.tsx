import { Plus, Trash2 } from "lucide-react";
import { createKeyValue, type KeyValue } from "@openapi-collection-studio/core";

interface KeyValueEditorProps {
  values: KeyValue[];
  onChange(values: KeyValue[]): void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({
  values,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value"
}: KeyValueEditorProps) {
  const update = (id: string, patch: Partial<KeyValue>) => {
    onChange(values.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  return (
    <div className="kv-editor">
      <div className="kv-editor__head">
        <span>Enabled</span>
        <span>Name</span>
        <span>Value</span>
        <span />
      </div>
      {values.map((item) => (
        <div className="kv-editor__row" key={item.id}>
          <input
            aria-label="Enabled"
            checked={item.enabled}
            onChange={(event) => update(item.id, { enabled: event.target.checked })}
            type="checkbox"
          />
          <input
            aria-label={keyPlaceholder}
            onChange={(event) => update(item.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
            value={item.key}
          />
          <input
            aria-label={valuePlaceholder}
            onChange={(event) => update(item.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
            value={item.value}
          />
          <button
            className="icon-button"
            onClick={() => onChange(values.filter((candidate) => candidate.id !== item.id))}
            title="Remove row"
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        className="secondary-button"
        onClick={() => onChange([...values, createKeyValue()])}
        type="button"
      >
        <Plus size={16} />
        Add row
      </button>
    </div>
  );
}

