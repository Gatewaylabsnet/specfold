import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { CollectionNode } from "./tree/nodes";
import type { CollectionTreeProps, DragState, TreeContext } from "./tree/types";

export type { DragKind, DropTarget, TreeActions } from "./tree/types";

export function CollectionTree(props: CollectionTreeProps) {
  const { collections, activeCollectionId } = props;
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [drag, setDrag] = useState<DragState>();
  const [dropHint, setDropHint] = useState<string>();
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(() => {
    const firstExpanded = activeCollectionId ?? collections[0]?.id;
    return firstExpanded ? new Set([firstExpanded]) : new Set();
  });
  const query = search.trim().toLowerCase();

  useEffect(() => {
    if (!activeCollectionId) return;
    setExpandedCollectionIds((current) => {
      if (current.has(activeCollectionId)) return current;
      const next = new Set(current);
      next.add(activeCollectionId);
      return next;
    });
  }, [activeCollectionId]);

  useEffect(() => {
    setExpandedCollectionIds((current) => {
      const collectionIds = new Set(collections.map((collection) => collection.id));
      const next = new Set([...current].filter((id) => collectionIds.has(id)));
      if (next.size === 0) {
        const firstExpanded = activeCollectionId ?? collections[0]?.id;
        if (firstExpanded) next.add(firstExpanded);
      }
      return next;
    });
  }, [activeCollectionId, collections]);

  const toggleCollectionExpanded = (collectionId: string) => {
    setExpandedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  };

  const context: TreeContext = {
    ...props, query, editingId, setEditingId, drag, setDrag, dropHint, setDropHint
  };

  return (
    <div className="tree-wrap">
      <div className="tree-search">
        <Search size={14} />
        <input aria-label="Search requests" onChange={(event) => setSearch(event.target.value)} placeholder="Search requests..." value={search} />
        {search && (
          <button className="tree-search__clear" onClick={() => setSearch("")} title="Clear search" type="button"><X size={13} /></button>
        )}
      </div>
      <div className="tree">
        {collections.map((collection) => (
          <CollectionNode
            collection={collection}
            context={context}
            expanded={query.length > 0 || expandedCollectionIds.has(collection.id)}
            key={collection.id}
            onToggleExpanded={() => toggleCollectionExpanded(collection.id)}
          />
        ))}
        {collections.length === 0 && (
          <div className="tree-empty">No collections yet. Import an OpenAPI document or create one.</div>
        )}
      </div>
    </div>
  );
}
