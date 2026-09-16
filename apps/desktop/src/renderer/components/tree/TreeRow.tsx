import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { ChevronDown, ChevronRight, Copy, Pencil, Star, Trash2 } from "lucide-react";
import type { TreeContext } from "./types";

export function TreeRow({
  id,
  className,
  icon,
  label,
  badge,
  expanded,
  indent,
  context,
  draggable,
  dropClass,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSelect,
  onToggleExpanded,
  onRename,
  favorite,
  onToggleFavorite,
  onDelete,
  onDuplicate
}: {
  id: string;
  className: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  expanded?: boolean;
  indent?: number;
  context: TreeContext;
  draggable?: boolean;
  dropClass?: string;
  onDragStart?(): void;
  onDragEnd?(): void;
  onDragOver?(): void;
  onDrop?(): void;
  onSelect(): void;
  onToggleExpanded?(): void;
  onRename(name: string): void;
  favorite?: boolean;
  onToggleFavorite?(): void;
  onDelete(): void;
  onDuplicate?(): void;
}) {
  const isEditing = context.editingId === id;
  const isSelected = /\bis-(active|selected)\b/.test(className);
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
  const stopActionPointer = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };
  const runAction = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    event.stopPropagation();
    action();
  };

  return (
    <div
      className={[
        "tree-row",
        onToggleExpanded ? "tree-row--expandable" : "",
        isSelected ? "tree-row--selected" : "",
        dropClass ?? ""
      ].filter(Boolean).join(" ")}
      draggable={draggable && !isEditing}
      onDragStart={
        onDragStart
          ? (event) => {
              if ((event.target as HTMLElement).closest(".tree-row__actions, .tree-row__toggle")) {
                event.preventDefault();
                return;
              }
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
      style={
        indent
          ? ({
              ["--tree-row-indent" as string]: `${indent}px`
            } as CSSProperties)
          : undefined
      }
    >
      {onToggleExpanded && (
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          className="tree-row__toggle"
          onClick={onToggleExpanded}
          title={expanded ? "Collapse" : "Expand"}
          type="button"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}
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
              aria-label="Rename item"
              className="tree-action"
              draggable={false}
              onClick={(event) => runAction(event, () => context.setEditingId(id))}
              onPointerDown={stopActionPointer}
              title={`Rename ${label}`}
              type="button"
            >
              <Pencil size={13} />
            </button>
            {onDuplicate && (
              <button
                aria-label="Duplicate item"
                className="tree-action"
                draggable={false}
                onClick={(event) => runAction(event, onDuplicate)}
                onPointerDown={stopActionPointer}
                title={`Duplicate ${label}`}
                type="button"
              >
                <Copy size={13} />
              </button>
            )}
            {onToggleFavorite && (
              <button
                aria-label={favorite ? "Unpin request" : "Pin request"}
                className={favorite ? "tree-action is-favorite" : "tree-action"}
                draggable={false}
                onClick={(event) => runAction(event, onToggleFavorite)}
                onPointerDown={stopActionPointer}
                title={favorite ? "Unpin request" : "Pin request"}
                type="button"
              >
                <Star fill={favorite ? "currentColor" : "none"} size={13} />
              </button>
            )}
            <button
              aria-label="Delete item"
              className="tree-action tree-action--danger"
              draggable={false}
              onClick={(event) => runAction(event, onDelete)}
              onPointerDown={stopActionPointer}
              title={`Delete ${label}`}
              type="button"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
