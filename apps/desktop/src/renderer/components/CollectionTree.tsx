import { ChevronRight, FileText, Folder, Layers } from "lucide-react";
import type { ApiRequest, Collection, Folder as FolderType } from "@openapi-collection-studio/core";

interface CollectionTreeProps {
  collections: Collection[];
  activeCollectionId?: string;
  selectedFolderId?: string;
  selectedRequestId?: string;
  onSelectCollection(collectionId: string): void;
  onSelectFolder(folderId: string): void;
  onSelectRequest(requestId: string): void;
}

export function CollectionTree({
  collections,
  activeCollectionId,
  selectedFolderId,
  selectedRequestId,
  onSelectCollection,
  onSelectFolder,
  onSelectRequest
}: CollectionTreeProps) {
  return (
    <div className="tree">
      {collections.map((collection) => (
        <div className="tree__collection" key={collection.id}>
          <button
            className={collection.id === activeCollectionId ? "tree__item is-active" : "tree__item"}
            onClick={() => onSelectCollection(collection.id)}
            type="button"
          >
            <Layers size={16} />
            <span>{collection.name}</span>
          </button>
          {collection.id === activeCollectionId && (
            <div className="tree__children">
              {collection.requests.map((request) => (
                <RequestNode
                  key={request.id}
                  onSelectRequest={onSelectRequest}
                  request={request}
                  selectedRequestId={selectedRequestId}
                />
              ))}
              {collection.folders.map((folder) => (
                <FolderNode
                  folder={folder}
                  key={folder.id}
                  onSelectFolder={onSelectFolder}
                  onSelectRequest={onSelectRequest}
                  selectedFolderId={selectedFolderId}
                  selectedRequestId={selectedRequestId}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FolderNode({
  folder,
  selectedFolderId,
  selectedRequestId,
  onSelectFolder,
  onSelectRequest,
  depth = 0
}: {
  folder: FolderType;
  selectedFolderId?: string;
  selectedRequestId?: string;
  onSelectFolder(folderId: string): void;
  onSelectRequest(requestId: string): void;
  depth?: number;
}) {
  return (
    <div className="tree__folder">
      <button
        className={folder.id === selectedFolderId ? "tree__item is-selected" : "tree__item"}
        onClick={() => onSelectFolder(folder.id)}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        type="button"
      >
        <ChevronRight size={14} />
        <Folder size={16} />
        <span>{folder.name}</span>
      </button>
      <div>
        {folder.requests.map((request) => (
          <RequestNode
            depth={depth + 1}
            key={request.id}
            onSelectRequest={onSelectRequest}
            request={request}
            selectedRequestId={selectedRequestId}
          />
        ))}
        {folder.folders.map((child) => (
          <FolderNode
            depth={depth + 1}
            folder={child}
            key={child.id}
            onSelectFolder={onSelectFolder}
            onSelectRequest={onSelectRequest}
            selectedFolderId={selectedFolderId}
            selectedRequestId={selectedRequestId}
          />
        ))}
      </div>
    </div>
  );
}

function RequestNode({
  request,
  selectedRequestId,
  onSelectRequest,
  depth = 0
}: {
  request: ApiRequest;
  selectedRequestId?: string;
  onSelectRequest(requestId: string): void;
  depth?: number;
}) {
  return (
    <button
      className={request.id === selectedRequestId ? "tree__item tree__request is-selected" : "tree__item tree__request"}
      onClick={() => onSelectRequest(request.id)}
      style={{ paddingLeft: `${28 + depth * 14}px` }}
      type="button"
    >
      <FileText size={15} />
      <span className={`method method--${request.method.toLowerCase()}`}>{request.method}</span>
      <span>{request.name}</span>
    </button>
  );
}

