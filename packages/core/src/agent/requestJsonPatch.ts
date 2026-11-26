export type JsonBodyPatch =
  | { op: "add" | "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export const MAX_EDIT_BODY_TEXT = 256 * 1024;
export const editBodyTextBytes = (text: string): number => new TextEncoder().encode(text).length;
export const editBodyHasControl = (text: string): boolean =>
  Array.from(text).some((character) => character.charCodeAt(0) < 32 || character === "\x7f");
const invalid = (): never => { throw new Error("REQUEST_BODY_INVALID"); };
const invalidPointer = (): never => { throw new Error("REQUEST_BODY_PATCH_INVALID"); };
const limit = (): never => { throw new Error("REQUEST_BODY_LIMIT"); };

export function copyEditJson(input: unknown): Json {
  let remaining = 20_000, text = MAX_EDIT_BODY_TEXT;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): Json => {
    if (--remaining < 0 || depth > 32) return limit();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return invalid();
      return value;
    }
    if (typeof value === "string") {
      text -= value.length;
      if (text < 0) return limit();
      return value;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return invalid();
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) return invalid();
    if (Object.getOwnPropertySymbols(value).length) return invalid();
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const read = (descriptor: PropertyDescriptor | undefined) => {
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return invalid();
      return visit(descriptor.value, depth + 1);
    };
    let result: Json;
    if (array) {
      if (value.length > remaining) return limit();
      if (Object.keys(descriptors).length !== value.length + 1) return invalid();
      result = Array.from({ length: value.length }, (_, index) => read(descriptors[index]));
    } else {
      result = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => {
        if (forbidden.has(key)) return invalid();
        text -= key.length;
        if (text < 0) return limit();
        return [key, read(descriptor)];
      }));
    }
    seen.delete(value);
    return result;
  };
  return visit(input, 0);
}

type Tokens = string[];

function parseSavedBody(raw: string): Json {
  if (raw.length > MAX_EDIT_BODY_TEXT || editBodyTextBytes(raw) > MAX_EDIT_BODY_TEXT) return limit();
  // JSON.parse alone silently drops duplicate members and rounds numeric
  // literals. Reject these before round-tripping an existing body.
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return invalid(); }
  const stack: Array<Set<string> | null> = [];
  for (const token of raw.matchAll(/("(?:[^"\\]|\\.)*"\s*:?)|([{}[\]])|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
    if (token[2] === "{" || token[2] === "[") {
      if (stack.length >= 33) return limit();
      stack.push(token[2] === "{" ? new Set() : null);
    } else if (token[2] === "}" || token[2] === "]") {
      stack.pop();
    } else if (token[1]?.endsWith(":")) {
      const previous = stack.at(-1);
      const key = JSON.parse(token[1].slice(0, -1)) as string;
      if (!previous || previous.has(key)) return invalid();
      previous.add(key);
    } else if (token[3] && !isLosslessNumber(token[3])) return invalid();
  }
  return copyEditJson(parsed);
}

function isLosslessNumber(raw: string): boolean {
  const value = Number(raw);
  if (!Number.isFinite(value) || Object.is(value, -0)) return false;
  const normalized = (token: string) => {
    const [mantissa, exponent = "0"] = token.toLowerCase().split("e");
    const [whole, fraction = ""] = mantissa.replace(/^-/, "").split(".");
    const digits = (whole + fraction).replace(/^0+/, "");
    if (!digits) return "0";
    // Only bounded exponents can produce a nonzero representable number.
    if (exponent.replace(/^[+-]?0*/, "").length > 6) return "overflow";
    const plain = digits.replace(/0+$/, "");
    return `${mantissa.startsWith("-") ? "-" : ""}${plain}e${Number(exponent) - fraction.length + digits.length - plain.length}`;
  };
  return normalized(raw) === normalized(String(value));
}

function pointer(path: string): Tokens {
  if (typeof path !== "string" || path.length > 1024 || (!path.startsWith("/") && path !== "")) return invalidPointer();
  if (!path) return [];
  const segments = path.slice(1).split("/");
  if (segments.length > 32 || segments.some((key) => /~(?![01])/.test(key))) return invalidPointer();
  const result = segments.map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (result.some((key) => forbidden.has(key) || editBodyHasControl(key))) return invalidPointer();
  return result;
}

function arrayIndex(key: string, length: number, adding: boolean): number {
  if (key === "-" && adding) return length;
  if (!/^(0|[1-9]\d*)$/.test(key)) return invalidPointer();
  const index = Number(key);
  if (!Number.isSafeInteger(index) || index > length || (!adding && index === length)) return invalidPointer();
  return index;
}

export function patchSavedJson(raw: string, patches: JsonBodyPatch[],
  inspectInput: (path: Tokens, value?: Json) => void): { value: Json; messages: string[]; unchanged: boolean } {
  if (!Array.isArray(patches) || !patches.length || patches.length > 64) return invalidPointer();
  let result = parseSavedBody(raw);
  const original = JSON.stringify(result);
  const messages: string[] = [];
  let suppliedBytes = 0;
  for (const edit of patches) {
    if (!edit || !["add", "replace", "remove"].includes(edit.op)) return invalidPointer();
    const path = pointer(edit.path);
    const value = edit.op === "remove" ? undefined : copyEditJson(edit.value);
    suppliedBytes += editBodyTextBytes(edit.path) + (value === undefined ? 0 : editBodyTextBytes(JSON.stringify(value)));
    if (suppliedBytes > MAX_EDIT_BODY_TEXT) return limit();
    inspectInput(path, value);
    const location = edit.path || "(JSON document root)";
    if (!path.length) {
      if (value === undefined) return invalidPointer(); // Use explicit body clear.
      result = value;
      messages.push(`Replace value at ${location}.`);
      continue;
    }
    let node = result;
    for (const segment of path.slice(0, -1)) {
      if (Array.isArray(node)) node = node[arrayIndex(segment, node.length, false)];
      else if (node && typeof node === "object" && Object.hasOwn(node, segment)) node = node[segment];
      else return invalidPointer();
    }
    const key = path.at(-1)!;
    let verb: string;
    if (Array.isArray(node)) {
      const index = arrayIndex(key, node.length, edit.op === "add");
      if (value === undefined) { node.splice(index, 1); verb = "Remove"; }
      else if (edit.op === "add") { node.splice(index, 0, value); verb = "Insert"; }
      else { node[index] = value; verb = "Replace"; }
    } else if (node && typeof node === "object") {
      const existing = Object.hasOwn(node, key);
      if (edit.op !== "add" && !existing) return invalidPointer();
      if (value === undefined) { delete node[key]; verb = "Remove"; }
      else { node[key] = value; verb = existing ? "Replace" : "Add"; }
    } else return invalidPointer();
    messages.push(`${verb} value at ${location}.`);
  }
  // Bound the combined output, not just individual instructions.
  return { value: copyEditJson(result), messages, unchanged: JSON.stringify(result) === original };
}
