import type { ConnectionProfile, Workspace } from "@openapi-collection-studio/core";
import { defaultAuth, savedProfiles, type SourceChoice } from "./model";

export function ConnectionStep({ workspace, profile, sourceText, sourceUrl, busy, onProfile, onLoadProfile, onSource,
  onUrl, onFile, onFetch, onContinue, canContinue }: {
  workspace: Workspace; profile: ConnectionProfile; sourceText?: string; sourceUrl: string; busy: boolean;
  onProfile(profile: ConnectionProfile): void; onLoadProfile(id: string): void; onSource(kind: SourceChoice): void;
  onUrl(value: string): void; onFile(): void; onFetch(): void; onContinue(): void; canContinue: boolean;
}) {
  const profiles = savedProfiles(workspace);
  return <section aria-labelledby="workflow-connection-title">
    <h2 id="workflow-connection-title">Connection</h2>
    <p>Choose the API and environment for this workflow. No API request is sent by continuing.</p>
    <div className="workflow-grid">
      <label className="field"><span>Existing profile</span><select aria-label="Existing profile" value={profiles.some((item) => item.id === profile.id) ? profile.id : ""}
        onChange={(event) => onLoadProfile(event.target.value)} disabled={busy}>
        <option value="">New profile</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="field"><span>Profile name</span><input aria-label="Profile name" value={profile.name}
        onChange={(event) => onProfile({ ...profile, name: event.target.value })} /></label>
      <label className="field"><span>Provider</span><select aria-label="Provider" value={profile.provider}
        onChange={(event) => { const provider = event.target.value as ConnectionProfile["provider"];
          onProfile({ ...profile, provider, auth: defaultAuth(provider === "apinizer" ? "apinizer" : "none", profile.baseUrl, profile.id) }); }}>
        <option value="openapi">OpenAPI / generic API</option><option value="apinizer">Apinizer gateway</option>
      </select></label>
      <label className="field"><span>Environment</span><select aria-label="Environment" value={profile.environmentId}
        onChange={(event) => onProfile({ ...profile, environmentId: event.target.value })}>
        {workspace.environments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    <fieldset className="workflow-source"><legend>API source</legend>
      {(["existing", "file", "url"] as const).map((kind) => <label key={kind}><input type="radio" name="workflow-source" checked={profile.source.kind === kind}
        onChange={() => onSource(kind)} disabled={busy} />{kind === "existing" ? "Existing collection" : kind === "file" ? "OpenAPI file" : "OpenAPI URL"}</label>)}
    </fieldset>
    {profile.source.kind === "existing" ? <label className="field"><span>Existing collection</span>
      <select aria-label="Existing collection" value={profile.collectionId} onChange={(event) => {
        const collection = workspace.collections.find((item) => item.id === event.target.value);
        onProfile({ ...profile, collectionId: event.target.value, baseUrl: collection?.baseUrl ?? profile.baseUrl,
          source: { kind: "existing", label: collection?.name ?? "Existing collection" } });
      }}><option value="">Choose a collection</option>{workspace.collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {!workspace.collections.length && <small>No saved collections yet. Choose an OpenAPI file or URL.</small>}
    </label> : <div className="workflow-source-input">
      {profile.source.kind === "file" ? <button type="button" className="secondary-button" disabled={busy} onClick={onFile}>Choose OpenAPI file</button>
        : <><label className="field"><span>OpenAPI URL</span><input aria-label="OpenAPI URL" type="url" value={sourceUrl} onChange={(event) => onUrl(event.target.value)}
          placeholder="https://api.example.com/openapi.json" /></label><button type="button" className="secondary-button" disabled={busy || !sourceUrl.trim()} onClick={onFetch}>Load OpenAPI URL</button></>}
      <p role="status">{sourceText ? `Loaded: ${profile.source.label}` : profile.collectionId ? `Saved source: ${profile.source.label}. Choose a new source only to re-import.` : "Load a specification before continuing."}</p>
      {profile.source.kind === "url" && <small>Loading a URL downloads the specification. It does not test its endpoints.</small>}
    </div>}
    <label className="field"><span>Base URL</span><input aria-label="Base URL" type="url" value={profile.baseUrl}
      onChange={(event) => onProfile({ ...profile, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
      <small>Use the API address without credentials, query parameters or a fragment. The preview shows each resolved destination.</small></label>
    {profile.provider === "apinizer" && <p className="workflow-note">The Apinizer preset uses your specification or saved collection. It does not discover APIs through a management account.</p>}
    <div className="workflow-actions"><button className="primary-button" type="button" disabled={busy || !canContinue} onClick={onContinue}>Continue</button></div>
  </section>;
}
