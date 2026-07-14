import type { Collection } from "../../model/types";

export const COLLECTION_JSON_SCHEMA = "specfold.collection.v1";
const LEGACY_COLLECTION_JSON_SCHEMA = "openapi-collection-studio.collection.v1";

export interface CollectionJsonDocument {
  schema: typeof COLLECTION_JSON_SCHEMA;
  exportedAt: string;
  collection: Collection;
}

export function serializeCollectionJson(collection: Collection): string {
  const document: CollectionJsonDocument = {
    schema: COLLECTION_JSON_SCHEMA,
    exportedAt: new Date().toISOString(),
    collection
  };
  return JSON.stringify(document, null, 2);
}

export function parseCollectionJson(text: string): Collection {
  const parsed = JSON.parse(text) as Partial<CollectionJsonDocument> & { schema?: string };
  const isSupportedSchema =
    parsed.schema === COLLECTION_JSON_SCHEMA || parsed.schema === LEGACY_COLLECTION_JSON_SCHEMA;
  if (!isSupportedSchema || !parsed.collection) {
    throw new Error("Not a Specfold collection JSON document.");
  }
  return parsed.collection;
}
