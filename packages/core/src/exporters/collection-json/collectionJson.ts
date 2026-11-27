import type { Collection } from "../../model/types";
import { stripTransientUploadData } from "../../model/sanitizeUploads";

export const COLLECTION_JSON_SCHEMA = "specfold.collection.v1";
const LEGACY_COLLECTION_JSON_SCHEMA = "openapi-collection-studio.collection.v1";

export interface CollectionJsonDocument {
  schema: typeof COLLECTION_JSON_SCHEMA;
  exportedAt: string;
  collection: Collection;
}

function withoutLocalTokenBinding(collection: Collection): Collection {
  const { autoAccessToken: _localBinding, autoTokenCaptureDisabled: _localOptOut, ...portable } = collection;
  return portable;
}

export function serializeCollectionJson(collection: Collection): string {
  const document: CollectionJsonDocument = {
    schema: COLLECTION_JSON_SCHEMA,
    exportedAt: new Date().toISOString(),
    collection: stripTransientUploadData(withoutLocalTokenBinding(collection), { rootKind: "collection" })
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
  return stripTransientUploadData(withoutLocalTokenBinding(parsed.collection), {
    disableFileFields: true,
    rootKind: "collection"
  });
}
