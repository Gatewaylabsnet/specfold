import type { Collection } from "../../model/types";

export interface CollectionJsonDocument {
  schema: "openapi-collection-studio.collection.v1";
  exportedAt: string;
  collection: Collection;
}

export function serializeCollectionJson(collection: Collection): string {
  const document: CollectionJsonDocument = {
    schema: "openapi-collection-studio.collection.v1",
    exportedAt: new Date().toISOString(),
    collection
  };
  return JSON.stringify(document, null, 2);
}

export function parseCollectionJson(text: string): Collection {
  const parsed = JSON.parse(text) as Partial<CollectionJsonDocument>;
  if (parsed.schema !== "openapi-collection-studio.collection.v1" || !parsed.collection) {
    throw new Error("Not an OpenAPI Collection Studio collection JSON document.");
  }
  return parsed.collection;
}

