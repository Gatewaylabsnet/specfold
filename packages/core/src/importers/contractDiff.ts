import type { ApiRequest, Collection, Workspace } from "../model/types";
import { flattenRequests } from "../model/traversal";
import { redactAgentValue, workspaceSecrets } from "../agent/redaction";
import { assertBoundedWorkflowValue, resolveWorkflowReferences, workflowDocument } from "../workflow/provenance";
import { contractCanonical, contractObject as object, diffContractSchema, type ContractSeverity } from "./contractSchemaDiff";

export interface ContractChange { operation: string; area: string; severity: ContractSeverity; message: string }
interface Operation { request: ApiRequest; value: Record<string, unknown>; parameters: unknown[]; unresolved: boolean }
const identity = (request: ApiRequest) => `${request.method} ${(request.openApi?.path ?? request.url).split(/[?#]/)[0].replace(/\{[^{}]+\}/g, "{parameter}")}`;
const security = (value: unknown) => Array.isArray(value) ? value.map((item) => Object.fromEntries(Object.entries(object(item)).sort(([a], [b]) => a.localeCompare(b)).map(([key, scopes]) => [key, Array.isArray(scopes) ? [...scopes].sort() : scopes]))).map(contractCanonical).sort() : undefined;

/** Local, bounded OpenAPI evidence comparison. Does not merge, delete, execute or fetch refs. */
export function diffOpenApiContracts(before: Collection, after: Collection): ContractChange[] {
  const changes: ContractChange[] = [];
  const push = (operation: string, area: string, severity: ContractSeverity, message: string) => { if (changes.length < 499) changes.push({ operation, area, severity, message }); };
  try {
    assertBoundedWorkflowValue(before); assertBoundedWorkflowValue(after);
    const secrets = workspaceSecrets({ collections: [before, after], environments: [] } as unknown as Workspace);
    function operations(collection: Collection) {
      const result = new Map<string, Operation>();
      const requests = flattenRequests(collection);
      if (requests.length > 500) throw new Error();
      for (const { request } of requests) {
        const key = identity(request);
        if (result.has(key)) { push(key, "operation", "unknown", "Duplicate normalized operation identities require manual review."); continue; }
        const resolved = resolveWorkflowReferences(request.openApi?.rawOperation ?? {}, workflowDocument(collection));
        const parameters = resolveWorkflowReferences(request.openApi?.rawParameters ?? object(resolved.value).parameters ?? [], workflowDocument(collection));
        result.set(key, { request, value: object(resolved.value), parameters: Array.isArray(parameters.value) ? parameters.value : [],
          unresolved: resolved.unresolved || parameters.unresolved || !["openapi3", "swagger2"].includes(request.openApi?.sourceFormat ?? "") });
      }
      return result;
    }
    const old = operations(before), next = operations(after);
    for (const key of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      const a = old.get(key), b = next.get(key);
      const report = (area: string, severity: ContractSeverity, message: string) => push(key, area, severity, message);
      if (!b) { report("operation", "breaking", "Operation is absent from the incoming contract. Safe import still retains the existing request."); continue; }
      if (!a) { report("operation", "additive", "A new operation was added."); continue; }
      if (before.openApi?.contractSourceUncertain || after.openApi?.contractSourceUncertain) { report("operation", "unknown", "A prior safe merge retained older shared component metadata. Import a fresh baseline for reliable comparison."); continue; }
      if (a.unresolved || b.unresolved) { report("operation", "unknown", "Source metadata or local references are incomplete/unsupported. No full compatibility claim is possible."); continue; }
      function parameterMap(operation: Operation) {
        const map = new Map<string, Record<string, unknown>>();
        for (const item of operation.parameters) {
          const parameter = object(item), id = `${parameter.in}:${parameter.name}`;
          if (map.has(id) || typeof parameter.name !== "string" || !["path", "query", "header", "cookie", "body", "formData"].includes(parameter.in as string)) report("parameters", "unknown", "An unsupported or duplicate parameter needs review.");
          else map.set(id, parameter);
        }
        return map;
      }
      const oldParams = parameterMap(a), newParams = parameterMap(b);
      for (const name of [...new Set([...oldParams.keys(), ...newParams.keys()])].sort()) {
        const p = oldParams.get(name), q = newParams.get(name), area = `input ${name}`;
        if (!p) report(area, q?.required === true || q?.in === "path" ? "breaking" : "additive", "An input was added; required inputs affect existing callers.");
        else if (!q) report(area, "unknown", "An input declaration was removed; continued server support requires review.");
        else {
          if (!!p.required !== !!q.required) report(area, q.required ? "breaking" : "additive", "Input requiredness changed.");
          const schema = (parameter: Record<string, unknown>) => parameter.schema ?? Object.fromEntries(Object.entries(parameter).filter(([key]) => !["name", "in", "required", "description"].includes(key)));
          diffContractSchema(schema(p), schema(q), false, report, area);
          for (const option of ["style", "explode", "allowReserved", "collectionFormat"]) if (contractCanonical(p[option]) !== contractCanonical(q[option])) report(area, "unknown", "Parameter serialization behavior changed.");
        }
      }
      function compareContent(x: unknown, y: unknown, response: boolean, area: string) {
        const left = object(x), right = object(y);
        for (const media of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
          if (!Object.hasOwn(right, media)) report(area, "breaking", "A documented media type was removed.");
          else if (!Object.hasOwn(left, media)) report(area, response ? "unknown" : "additive", "A documented media type was added.");
          else diffContractSchema(object(left[media]).schema, object(right[media]).schema, response, report, `${area} ${media}`);
        }
      }
      const oldBody = object(a.value.requestBody), newBody = object(b.value.requestBody);
      if (!!oldBody.required !== !!newBody.required) report("request body", newBody.required ? "breaking" : "additive", "Request body requiredness changed.");
      compareContent(oldBody.content, newBody.content, false, "request body");
      const oldResponses = object(a.value.responses), newResponses = object(b.value.responses);
      for (const status of [...new Set([...Object.keys(oldResponses), ...Object.keys(newResponses)])].sort()) {
        if (!Object.hasOwn(newResponses, status)) report("response", "breaking", "A documented response status was removed.");
        else if (!Object.hasOwn(oldResponses, status)) report("response", "unknown", "An additional response status requires consumer/error-handling review.");
        else {
          const x = object(oldResponses[status]), y = object(newResponses[status]);
          diffContractSchema(x.schema, y.schema, true, report, `response ${status}`); // Swagger schema.
          compareContent(x.content, y.content, true, `response ${status}`);
          if (contractCanonical(x.headers) !== contractCanonical(y.headers)) report(`response ${status}`, "unknown", "Response header declarations changed.");
        }
      }
      const oldSecurity = security(a.value.security ?? before.openApi?.security), newSecurity = security(b.value.security ?? after.openApi?.security);
      if (!oldSecurity || !newSecurity) report("authentication", "unknown", "Inherited security evidence is missing from older metadata; verify authentication requirements.");
      else if (contractCanonical(oldSecurity) !== contractCanonical(newSecurity)) report("authentication", !oldSecurity.length && newSecurity.length ? "breaking" : "unknown", "Declared authentication requirements/scopes changed; review access expectations.");
      if (contractCanonical(before.openApi?.securitySchemes) !== contractCanonical(after.openApi?.securitySchemes)) report("authentication", "unknown", "Security scheme definitions changed; compatibility requires review.");
    }
    if (changes.length >= 499) changes.push({ operation: "All operations", area: "limits", severity: "unknown", message: "Change output was bounded; remaining differences need manual review." });
    return redactAgentValue(changes, secrets).sort((a, b) => `${a.operation}|${a.area}|${a.severity}|${a.message}`.localeCompare(`${b.operation}|${b.area}|${b.severity}|${b.message}`));
  } catch { return [{ operation: "All operations", area: "limits", severity: "unknown", message: "Contract evidence is invalid or exceeds local comparison limits. No compatibility verdict was produced." }]; }
}
