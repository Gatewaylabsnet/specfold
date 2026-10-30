export type ContractSeverity = "breaking" | "additive" | "unknown";
export type SchemaReporter = (area: string, severity: ContractSeverity, message: string) => void;
export const contractObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const annotations = new Set(["title", "description", "example", "examples", "externalDocs", "$comment", "xml"]);
export function contractCanonical(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).filter(([key]) => !annotations.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : input;
  return JSON.stringify(normalize(value)) ?? "undefined";
}
const set = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(contractCanonical))].sort() : [];
const keywords = new Set(["type", "nullable", "properties", "required", "additionalProperties", "items", "enum", "const", "uniqueItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties", "default", ...annotations]);

/** Supported subset, directional request/response variance; unknowns never imply compatibility. */
export function diffContractSchema(before: unknown, after: unknown, response: boolean, report: SchemaReporter, area: string, depth = 0): void {
  if (depth > 12) { report(area, "unknown", "Schema comparison exceeded its depth limit."); return; }
  if (before === undefined || after === undefined) {
    if (before !== after) report(area, "unknown", "Schema evidence was added or removed; compatibility needs review.");
    return;
  }
  if ([before, after].some((item) => item !== true && item !== false && (!item || typeof item !== "object" || Array.isArray(item)))) { report(area, "unknown", "A schema has an unsupported shape."); return; }
  const old = contractObject(before), next = contractObject(after);
  const restriction = (narrower: boolean): ContractSeverity => narrower !== response ? "breaking" : "additive";
  if (Object.keys(old).some((key) => !keywords.has(key)) || Object.keys(next).some((key) => !keywords.has(key))) report(area, "unknown", "Unsupported schema constraints require review; full compatibility is not established.");
  if (before === false || after === false) {
    if (before !== after) report(area, restriction(after === false), "The schema's acceptance of values changed.");
    return;
  }
  if (contractCanonical(old.type) !== contractCanonical(next.type)) {
    const widening = old.type === "integer" && next.type === "number", narrowing = old.type === "number" && next.type === "integer";
    report(area, widening || narrowing ? restriction(narrowing) : "breaking", "The declared value type changed.");
  }
  if (!!old.nullable !== !!next.nullable) report(area, restriction(!next.nullable), "Nullability changed.");
  if (Array.isArray(old.type) || Array.isArray(next.type)) report(area, "unknown", "Union type compatibility requires review.");
  for (const key of ["enum", "const"] as const) {
    const a = key === "const" ? Object.hasOwn(old, key) ? [contractCanonical(old[key])] : [] : set(old[key]);
    const b = key === "const" ? Object.hasOwn(next, key) ? [contractCanonical(next[key])] : [] : set(next[key]);
    if (contractCanonical(a) !== contractCanonical(b)) {
      const narrower = (!a.length && !!b.length) || (!!b.length && b.every((item) => a.includes(item)));
      const wider = (!b.length && !!a.length) || (!!a.length && a.every((item) => b.includes(item)));
      report(area, narrower || wider ? restriction(narrower) : "breaking", "Allowed literal values changed; values are omitted.");
    }
  }
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]) {
    const a = old[key], b = next[key]; if (a === b) continue;
    if ((a !== undefined && typeof a !== "number") || (b !== undefined && typeof b !== "number")) { report(area, "unknown", "A constraint bound is unsupported."); continue; }
    const narrower = b !== undefined && (a === undefined || (key.startsWith("min") ? (b as number) > (a as number) : (b as number) < (a as number)));
    report(area, restriction(narrower), "A size or numeric bound changed; literal limits are omitted.");
  }
  for (const key of ["exclusiveMinimum", "exclusiveMaximum", "multipleOf"]) if (contractCanonical(old[key]) !== contractCanonical(next[key])) report(area, "unknown", "An exclusive bound or numeric divisibility constraint changed.");
  if (!!old.uniqueItems !== !!next.uniqueItems) report(area, restriction(!!next.uniqueItems), "Array uniqueness requirements changed.");
  if (contractCanonical(old.default) !== contractCanonical(next.default)) report(area, "unknown", "Documented default behavior changed; values are omitted.");
  const oldRequired = set(old.required), newRequired = set(next.required);
  if (newRequired.some((key) => !oldRequired.includes(key))) report(area, restriction(true), "Required object properties were added.");
  if (oldRequired.some((key) => !newRequired.includes(key))) report(area, restriction(false), "Required object properties were removed.");
  const oldProperties = contractObject(old.properties), newProperties = contractObject(next.properties);
  for (const key of [...new Set([...Object.keys(oldProperties), ...Object.keys(newProperties)])].sort()) {
    const child = `${area}.${key}`.slice(0, 256);
    if (!Object.hasOwn(oldProperties, key)) report(child, "additive", "An optional or newly required property was added; see required-property changes.");
    else if (!Object.hasOwn(newProperties, key)) report(child, response && oldRequired.includes(contractCanonical(key)) ? "breaking" : "unknown", "A declared property was removed; consumer behavior needs review.");
    else diffContractSchema(oldProperties[key], newProperties[key], response, report, child, depth + 1);
  }
  const a = old.additionalProperties ?? true, b = next.additionalProperties ?? true;
  if (typeof a === "boolean" && typeof b === "boolean") {
    if (a !== b) report(area, restriction(!b), "Acceptance of additional object properties changed.");
  } else if (typeof a === "object" && typeof b === "object") diffContractSchema(a, b, response, report, `${area}.*`, depth + 1);
  else if (contractCanonical(a) !== contractCanonical(b)) report(area, "unknown", "Additional-property schema policy changed.");
  if (old.items !== undefined || next.items !== undefined) diffContractSchema(old.items, next.items, response, report, `${area}[]`, depth + 1);
}
