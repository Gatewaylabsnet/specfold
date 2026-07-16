import { useEffect, useRef, useState } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { TreeContext } from "./types";

export function TreeRow({
  id,
  className,
  icon,
  label,
  badge,
  indent,
  context,
  draggable,
  dropClass,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSelect,
  onRename,
  onDelete,
  onDuplicate
}: {
  id: string;
  className: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  indent?: number;
  context: TreeContext;
  draggable?: boolean;
  dropClass?: string;
  onDragStart?(): void;
  onDragEnd?(): void;
  onDragOver?(): void;
  onDrop?(): void;
  onSelect(): void;
  onRename(name: string): void;
  onDelete(): void;
  onDuplicate?(): void;
}) {
  const isEditing = context.editingId === id;
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(label);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, label]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) {
      onRename(next);
    }
    context.setEditingId(undefined);
  };

  return (
    <div
      className={dropClass ? `tree-row ${dropClass}` : "tree-row"}
      draggable={draggable && !isEditing}
      onDragStart={
        onDragStart
          ? (event) => {
              event.dataTransfer.effectAllowed = "move";
              // Firefox requires data to be set for a drag to start.
              event.dataTransfer.setData("text/plain", id);
              onDragStart();
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      onDragOver={
        onDragOver
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onDragOver();
            }
          : undefined
      }
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault();
              onDrop();
            }
          : undefined
      }
      style={indent ? { paddingLeft: `${indent}px` } : undefined}
    >
      {isEditing ? (
        <div className={`${className} tree-row__edit`}>
          {icon}
          <input
            onBlur={commit}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit();
              }
              if (event.key === "Escape") {
                context.setEditingId(undefined);
              }
            }}
            ref={inputRef}
            value={draft}
          />
        </div>
      ) : (
        <>
          <button className={className} onClick={onSelect} onDoubleClick={() => context.setEditingId(id)} type="button">
            {icon}
            <span className="tree-row__label" title={label}>
              {label}
            </span>
            {badge && <span className="tree-row__badge">{badge}</span>}
          </button>
          <div className="tree-row__actions">
            <button
              className="tree-action"
              onClick={() => context.setEditingId(id)}
              title="Rename"
              type="button"
            >
              <Pencil size={13} />
            </button>
            {onDuplicate && (
              <button className="tree-action" onClick={onDuplicate} title="Duplicate" type="button">
                <Copy size={13} />
              </button>
            )}
            <button className="tree-action tree-action--danger" onClick={onDelete} title="Delete" type="button">
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
