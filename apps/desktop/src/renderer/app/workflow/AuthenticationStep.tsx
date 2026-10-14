import type { ConnectionProfile, WorkflowAuth, Workspace } from "@openapi-collection-studio/core";
import { credentialFields, defaultAuth } from "./model";

export function AuthenticationStep({ workspace, profile, credentials, secureStorageAvailable, busy, valid, onAuth, onCredential, onBack, onSave }: {
  workspace: Workspace; profile: ConnectionProfile; credentials: Record<string, string>; secureStorageAvailable: boolean;
  busy: boolean; valid: boolean; onAuth(auth: WorkflowAuth): void; onCredential(variable: string, value: string): void; onBack(): void; onSave(): void;
}) {
  const auth = profile.auth;
  const fields = credentialFields(auth);
  const variables = workspace.environments.find((item) => item.id === profile.environmentId)?.variables ?? [];
  const setVariable = (key: string, value: string) => onAuth({ ...auth, [key]: value } as WorkflowAuth);
  return <section aria-labelledby="workflow-auth-title">
    <h2 id="workflow-auth-title">Authentication</h2>
    <p>Credentials are saved by Specfold to encrypted environment variables. This screen never reloads stored secret values.</p>
    <label className="field"><span>Authentication</span><select aria-label="Authentication" value={auth.kind} disabled={busy}
      onChange={(event) => onAuth(defaultAuth(event.target.value as WorkflowAuth["kind"], profile.baseUrl, profile.id))}>
      <option value="none">No authentication</option><option value="bearer">Bearer token</option><option value="basic">Basic authentication</option>
      <option value="apiKey">API key</option>{profile.provider === "apinizer" && <option value="apinizer">Apinizer JWT token</option>}
    </select></label>
    {auth.kind === "apinizer" && <><p className="workflow-note">Specfold requests a token from your gateway's issuer endpoint. It does not sign JWTs or ask for a signing key.</p>
      <label className="field"><span>Token endpoint</span><input aria-label="Token endpoint" type="url" value={auth.endpoint}
        onChange={(event) => onAuth({ ...auth, endpoint: event.target.value })} /><small>The default is the base URL's origin followed by /auth/jwt. Check your gateway configuration.</small></label></>}
    {auth.kind === "apiKey" && <div className="workflow-grid"><label className="field"><span>API key name</span><input aria-label="API key name" value={auth.key}
      onChange={(event) => onAuth({ ...auth, key: event.target.value })} /></label><label className="field"><span>API key location</span><select aria-label="API key location" value={auth.in}
        onChange={(event) => onAuth({ ...auth, in: event.target.value as "header" | "query" })}><option value="header">Header</option><option value="query">Query parameter</option></select></label></div>}
    <div className="workflow-grid">{fields.filter((field) => field.key !== "clientSecretVariable").map((field) => <label className="field" key={field.key}><span>{field.label}</span>
      <input type="password" autoComplete="new-password" aria-label={field.label} value={credentials[field.variable] ?? ""}
        onChange={(event) => onCredential(field.variable, event.target.value)} placeholder="Leave blank to keep the stored value" disabled={busy} />
      <small>{variables.some((item) => item.name === field.variable) ? "Stored credential available; leave blank to keep it." : "Saved securely for this profile."}</small>
    </label>)}</div>
    {auth.kind !== "none" && <details className="workflow-advanced"><summary>Advanced: variable references</summary>
      <p>New authentication settings use variables unique to this profile. You can deliberately reuse an existing variable here; changing its value also affects other profiles that reference it. Blank credential fields keep existing values.</p>
      <datalist id="workflow-variable-names">{variables.map((item) => <option key={item.id} value={item.name} />)}</datalist>
      <div className="workflow-grid">{fields.map((field) => <label className="field" key={field.key}><span>{field.label} variable</span>
        <input aria-label={`${field.label} variable`} list="workflow-variable-names" value={field.variable} onChange={(event) => setVariable(field.key, event.target.value)} /></label>)}
        {auth.kind === "apinizer" && <label className="field"><span>Captured token variable</span><input aria-label="Captured token variable" list="workflow-variable-names" value={auth.tokenVariable}
          onChange={(event) => onAuth({ ...auth, tokenVariable: event.target.value })} /></label>}
      </div>
      {auth.kind === "apinizer" && <><label className="workflow-check"><input type="checkbox" checked={!!auth.clientSecretVariable}
        onChange={(event) => { const next = { ...auth }; if (event.target.checked) next.clientSecretVariable = `workflow_${profile.id.replace(/[^a-z0-9_]/gi, "_").slice(-64)}_clientSecret`; else delete next.clientSecretVariable; onAuth(next); }} />My issuer requires a client secret</label>
        {auth.clientSecretVariable && <label className="field"><span>Client secret</span><input type="password" autoComplete="new-password" aria-label="Client secret"
          value={credentials[auth.clientSecretVariable] ?? ""} onChange={(event) => onCredential(auth.clientSecretVariable!, event.target.value)} placeholder="Leave blank to keep the stored value" /></label>}
        <small>Only enable this if required by your issuer. No placeholder credential is sent.</small></>}
    </details>}
    {!secureStorageAvailable && <p role="alert" className="workflow-note">Secure storage is unavailable. Authenticated workflows require OS secure storage; restore it before saving authentication settings or credentials.</p>}
    <p>Saving creates or updates this profile and its collection. It does not send test requests. The next step previews the exact test selection.</p>
    <div className="workflow-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onBack}>Back to connection</button>
      <button type="button" className="primary-button" disabled={busy || !valid} onClick={onSave}>{busy ? "Saving…" : "Save & preview"}</button></div>
  </section>;
}
