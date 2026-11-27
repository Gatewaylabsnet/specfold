import type { AuthConfig, Folder } from "@openapi-collection-studio/core";

export function RequestAuthFields({
  auth,
  collectionTokenVariable,
  collectionTokenSettings,
  folderAuthScope,
  folderAccessTokenVariable,
  onFolderTokenVariableChange,
  onChange
}: {
  auth: AuthConfig;
  collectionTokenVariable?: string;
  collectionTokenSettings?: { enabled: boolean; onChange(enabled: boolean): void };
  folderAuthScope?: {
    folder: Folder;
    parentVariable?: string;
  };
  folderAccessTokenVariable?: string;
  onFolderTokenVariableChange(folderId: string, variableName: string): void;
  onChange(auth: AuthConfig): void;
}) {
  const folderTokenReference = folderAccessTokenVariable
    ? `{{${folderAccessTokenVariable}}}`
    : undefined;
  const folderTokenBinding = folderAuthScope ? (
    <div className="auth-folder-token">
      <label className="field">
        <span>Folder token variable</span>
        <input
          aria-label="Folder access token variable"
          onChange={(event) =>
            onFolderTokenVariableChange(folderAuthScope.folder.id, event.target.value.trim())
          }
          pattern="[A-Za-z_][A-Za-z0-9_.-]*"
          placeholder={folderAuthScope.parentVariable ?? "ordersAccessToken"}
          title="Use a valid environment variable name, such as ordersAccessToken."
          value={folderAuthScope.folder.accessTokenVariable ?? ""}
        />
        <small>
          {folderAuthScope.folder.accessTokenVariable
            ? `Bearer requests in ${folderAuthScope.folder.name} can use this environment secret.`
            : folderAuthScope.parentVariable
              ? `Empty inherits ${folderAuthScope.parentVariable} from the parent folder.`
              : "Save a response token here as an encrypted environment secret for this folder."}
        </small>
      </label>
    </div>
  ) : null;
  const sharedTokenFields = <>
    {collectionTokenVariable && <p className="ops-hint">Uses the collection Bearer token from encrypted variable <code>{collectionTokenVariable}</code>.</p>}
    {collectionTokenSettings && <div className="auth-folder-token">
      <label className="check-row">
        <input type="checkbox" checked={collectionTokenSettings.enabled}
          onChange={(event) => collectionTokenSettings.onChange(event.target.checked)} />
        <span>Capture and use the collection token automatically</span>
      </label>
      <small>After a successful token request, eligible requests at the same origin use the encrypted token. Explicit request auth and folder tokens take priority.</small>
    </div>}
    {folderTokenBinding}
  </>;

  if (auth.type === "none") return sharedTokenFields;
  if (auth.type === "bearer") {
    return (
      <>
        {sharedTokenFields}
        <div className="auth-token-field">
          <label className="field">
            <span>Token</span>
            <input
              aria-label="Token"
              onChange={(event) => onChange({ ...auth, token: event.target.value })}
              value={auth.token}
            />
          </label>
          {folderTokenReference && (
            <button
              className="secondary-button"
              disabled={auth.token === folderTokenReference}
              onClick={() => onChange({ ...auth, token: folderTokenReference })}
              type="button"
            >
              {auth.token === folderTokenReference ? "Using folder token" : "Use folder token"}
            </button>
          )}
        </div>
      </>
    );
  }
  if (auth.type === "basic") {
    return (
      <>
        {sharedTokenFields}
        <label className="field">
          <span>Username</span>
          <input
            onChange={(event) => onChange({ ...auth, username: event.target.value })}
            value={auth.username}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            onChange={(event) => onChange({ ...auth, password: event.target.value })}
            type="password"
            value={auth.password}
          />
        </label>
      </>
    );
  }
  return (
    <>
      {sharedTokenFields}
      <label className="field">
        <span>Location</span>
        <select
          onChange={(event) =>
            onChange({ ...auth, in: event.target.value === "query" ? "query" : "header" })
          }
          value={auth.in}
        >
          <option value="header">Header</option>
          <option value="query">Query</option>
        </select>
      </label>
      <label className="field">
        <span>Key</span>
        <input onChange={(event) => onChange({ ...auth, key: event.target.value })} value={auth.key} />
      </label>
      <label className="field">
        <span>Value</span>
        <input onChange={(event) => onChange({ ...auth, value: event.target.value })} value={auth.value} />
      </label>
    </>
  );
}
