import { useState } from "react";
import { createId, flattenRequests, validateBusinessRules, type BusinessRule, type Collection } from "@openapi-collection-studio/core";

export function RulesEditor({ rules, collection, onChange }: { rules: BusinessRule[]; collection?: Collection; onChange(rules: BusinessRule[]): void }) {
  const requests = collection ? flattenRequests(collection).map(({ request }) => request) : [];
  const [requestId, setRequestId] = useState(requests[0]?.id ?? ""), [path, setPath] = useState("/count");
  const [kind, setKind] = useState<BusinessRule["kind"]>("exists"), [type, setType] = useState("number");
  const [minimum, setMinimum] = useState("0"), [maximum, setMaximum] = useState("100");
  const [constantKind, setConstantKind] = useState("number"), [constant, setConstant] = useState("0");
  const [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  function add() {
    try {
      if (!reviewed || !requests.some((request) => request.id === requestId)) throw new Error();
      const base = { id: createId("rule"), requestId, path, kind };
      const next = kind === "type" ? { ...base, type } : kind === "range" ? { ...base, minimum: minimum.trim() ? Number(minimum) : NaN, maximum: maximum.trim() ? Number(maximum) : NaN }
        : kind === "equals" ? { ...base, value: constantKind === "null" ? null : constantKind === "boolean" ? constant === "true" : constant.trim() ? Number(constant) : NaN } : base;
      onChange(validateBusinessRules([...rules, next])); setReviewed(false); setError("");
    } catch { setError("Choose a supported non-sensitive JSON pointer and valid number/boolean/null constraints. At most 16 rules are allowed."); }
  }
  return <details className="workflow-advanced"><summary>No-code response rules ({rules.length})</summary>
    <p>Rules apply only to the chosen request after a newly approved run. No scripts, regex, string constants or credential/personal-field paths. Values and paths are omitted from reports and safe history. Use synthetic, non-secret constraints only.</p>
    <ul>{rules.map((rule, index) => <li key={rule.id}>Rule {index + 1}: {requests.find((request) => request.id === rule.requestId)?.name ?? "Missing request"} · {rule.path || "root"} · {rule.kind}
      {rule.kind === "type" ? ` ${rule.type}` : rule.kind === "range" ? ` ${rule.minimum} to ${rule.maximum}` : rule.kind === "equals" ? ` ${String(rule.value)}` : ""}
      <button type="button" className="secondary-button" onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}>Remove rule {index + 1}</button></li>)}</ul>
    {!requests.length ? <p>Choose an existing collection to configure request-specific rules. Imported APIs can have rules added after their first setup save.</p> : <>
      <label className="field"><span>Rule request</span><select aria-label="Rule request" value={requestId} onChange={(event) => { setRequestId(event.target.value); setReviewed(false); }}>{requests.map((request) => <option key={request.id} value={request.id}>{request.method} {request.name}</option>)}</select></label>
      <label className="field"><span>Rule JSON pointer</span><input aria-label="Rule JSON pointer" value={path} placeholder="/summary/count" onChange={(event) => { setPath(event.target.value); setReviewed(false); }} /></label>
      <label className="field"><span>Rule check</span><select aria-label="Rule check" value={kind} onChange={(event) => { setKind(event.target.value as BusinessRule["kind"]); setReviewed(false); }}><option value="exists">Field exists</option><option value="type">Field type</option><option value="range">Numeric range</option><option value="equals">Equals primitive constant</option></select></label>
      {kind === "type" && <label className="field"><span>Expected type</span><select aria-label="Expected rule type" value={type} onChange={(event) => { setType(event.target.value); setReviewed(false); }}>{["number", "integer", "boolean", "string", "object", "array", "null"].map((item) => <option key={item}>{item}</option>)}</select></label>}
      {kind === "range" && <div className="workflow-grid"><label className="field"><span>Minimum</span><input aria-label="Rule minimum" type="number" value={minimum} onChange={(event) => { setMinimum(event.target.value); setReviewed(false); }} /></label><label className="field"><span>Maximum</span><input aria-label="Rule maximum" type="number" value={maximum} onChange={(event) => { setMaximum(event.target.value); setReviewed(false); }} /></label></div>}
      {kind === "equals" && <><label className="field"><span>Constant type</span><select aria-label="Rule constant type" value={constantKind} onChange={(event) => { setConstantKind(event.target.value); setConstant(event.target.value === "boolean" ? "true" : "0"); setReviewed(false); }}><option value="number">Number</option><option value="boolean">Boolean</option><option value="null">Null</option></select></label>
        {constantKind === "number" && <label className="field"><span>Constant</span><input aria-label="Rule constant" type="number" value={constant} onChange={(event) => { setConstant(event.target.value); setReviewed(false); }} /></label>}
        {constantKind === "boolean" && <label className="field"><span>Constant</span><select aria-label="Rule constant" value={constant} onChange={(event) => { setConstant(event.target.value); setReviewed(false); }}><option>true</option><option>false</option></select></label>}</>}
      <label className="check-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed this non-secret rule definition and approve saving it with this setup.</label>
      <button type="button" className="secondary-button" disabled={!reviewed || rules.length >= 16} onClick={add}>Add reviewed rule</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
