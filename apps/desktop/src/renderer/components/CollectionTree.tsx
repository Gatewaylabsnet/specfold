import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, FileText, Folder, Layers, Pencil, Search, Trash2, X } from "lucide-react";
import type { ApiRequest, Collection, Folder as FolderType } from "@openapi-collection-studio/core";

export interface TreeActions {
  onSelectCollection(collectionId: string): void;
  onSelectFolder(folderId: string): void;
  onSelectRequest(requestId: string): void;
  onRenameCollection(collectionId: string, name: string): void;
  onDeleteCollection(collectionId: string): void;
  onRenameFolder(folderId: string, name: string): void;
  onDeleteFolder(folderId: string): void;
  onDuplicateFolder(folderId: string): void;
  onRenameRequest(requestId: string, name: string): void;
  onDeleteRequest(requestId: string): void;
  onDuplicateRequest(requestId: string): void;
}

interface CollectionTreeProps extends TreeActions {
  collections: Collection[];
  activeCollectionId?: string;
  selectedFolderId?: string;
  selectedRequestId?: string;
}

export function CollectionTree(props: CollectionTreeProps) {
  const { collections, activeCollectionId } = props;
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const query = search.trim().toLowerCase();

  const treeContext: TreeContext = {
    ...props,
    query,
    editingId,
    setEditingId
  };

  return (
    <div className="tree-wrap">
      <div className="tree-search">
        <Search size={14} />
        <input
          aria-label="Search requests"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search requests..."
          value={search}
        />
        {search && (
          <button className="tree-search__clear" onClick={() => setSearch("")} title="Clear search" type="button">
            <X size={13} />
          </button>
        )}
      </div>
      <div className="tree">
        {collections.map((collection) => (
          <CollectionNode
            collection={collection}
            context={treeContext}
            expanded={collection.id === activeCollectionId || query.length > 0}
            key={collection.id}
          />
        ))}
        {collections.length === 0 && (
          <div className="tree-empty">No collections yet. Import an OpenAPI document or create one.</div>
        )}
      </div>
    </div>
  );
}

interface TreeContext extends TreeActions {
  activeCollectionId?: string;
  selectedFolderId?: string;
  selectedRequestId?: string;
  query: string;
  editingId?: string;
  setEditingId(id?: string): void;
}

function requestMatches(request: ApiRequest, query: string): boolean {
  return (
    request.name.toLowerCase().includes(query) ||
    request.url.toLowerCase().includes(query) ||
    request.method.toLowerCase().includes(query)
  );
}

function folderMatchCount(folder: FolderType, query: string): number {
  let count = folder.requests.filter((request) => requestMatches(request, query)).length;
  for (const child of folder.folders) {
    count += folderMatchCount(child, query);
  }
  return count;
}

function CollectionNode({
  collection,
  context,
  expanded
}: {
  collection: Collection;
  context: TreeContext;
  expanded: boolean;
}) {
  const { query } = context;
  const visibleRootRequests = query
    ? collection.requests.filter((request) => requestMatches(request, query))
    : collection.requests;
  const visibleFolders = query
    ? collection.folders.filter(
        (folder) => folder.name.toLowerCase().includes(query) || folderMatchCount(folder, query) > 0
      )
    : collection.folders;

  if (query && visibleRootRequests.length === 0 && visibleFolders.length === 0) {
    return null;
  }

  const isActive = collection.id === context.activeCollectionId;

  return (
    <div className="tree__collection">
      <TreeRow
        className={isActive ? "tree__item is-active" : "tree__item"}
        icon={
          <>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Layers size={16} />
          </>
        }
        id={collection.id}
        label={collection.name}
        context={context}
        onSelect={() => context.onSelectCollection(collection.id)}
        onRename={(name) => context.onRenameCollection(collection.id, name)}
        onDelete={() => context.onDeleteCollection(collection.id)}
      />
      {expanded && (
        <div className="tree__children">
          {visibleRootRequests.map((request) => (
            <RequestNode context={context} key={request.id} request={request} />
          ))}
          {visibleFolders.map((folder) => (
            <FolderNode context={context} folder={folder} key={folder.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderNode({
  folder,
  context,
  depth = 0
}: {
  folder: FolderType;
  context: TreeContext;
  depth?: number;
}) {
  const { query } = context;
  const visibleRequests = query
    ? folder.requests.filter((request) => requestMatches(request, query))
    : folder.requests;
  const visibleFolders = query
    ? folder.folders.filter(
        (child) => child.name.toLowerCase().includes(query) || folderMatchCount(child, query) > 0
      )
    : folder.folders;

  return (
    <div className="tree__folder">
      <TreeRow
        className={folder.id === context.selectedFolderId ? "tree__item is-selected" : "tree__item"}
        icon={
          <>
            <ChevronRight size={14} />
            <Folder size={16} />
          </>
        }
        id={folder.id}
        indent={8 + depth * 14}
        label={folder.name}
        badge={query ? undefined : String(folder.requests.length || "")}
        context={context}
        onSelect={() => context.onSelectFolder(folder.id)}
        onRename={(name) => context.onRenameFolder(folder.id, name)}
        onDelete={() => context.onDeleteFolder(folder.id)}
        onDuplicate={() => context.onDuplicateFolder(folder.id)}
      />
      <div>
        {visibleRequests.map((request) => (
          <RequestNode context={context} depth={depth + 1} key={request.id} request={request} />
        ))}
        {visibleFolders.map((child) => (
          <FolderNode context={context} depth={depth + 1} folder={child} key={child.id} />
        ))}
      </div>
    </div>
  );
}

function RequestNode({
  request,
  context,
  depth = 0
}: {
  request: ApiRequest;
  context: TreeContext;
  depth?: number;
}) {
  return (
    <TreeRow
      className={
        request.id === context.selectedRequestId
          ? "tree__item tree__request is-selected"
          : "tree__item tree__request"
      }
      icon={
        <>
          <FileText size={15} />
          <span className={`method method--${request.method.toLowerCase()}`}>{request.method}</span>
        </>
      }
      id={request.id}
      indent={28 + depth * 14}
      label={request.name}
      context={context}
      onSelect={() => context.onSelectRequest(request.id)}
      onRename={(name) => context.onRenameRequest(request.id, name)}
      onDelete={() => context.onDeleteRequest(request.id)}
      onDuplicate={() => context.onDuplicateRequest(request.id)}
    />
  );
}

/**
 * One tree row: click selects, hover reveals rename/duplicate/delete actions,
 * rename switches the label to an inline input (Enter commits, Escape cancels).
 */
function TreeRow({
  id,
  className,
  icon,
  label,
  badge,
  indent,
  context,
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
    <div className="tree-row" style={indent ? { paddingLeft: `${indent}px` } : undefined}>
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
