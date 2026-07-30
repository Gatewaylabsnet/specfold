import type { AuthConfig } from "@openapi-collection-studio/core";

export function RequestAuthFields({
  auth,
  folderAccessTokenVariable,
  onChange
}: {
  auth: AuthConfig;
  folderAccessTokenVariable?: string;
  onChange(auth: AuthConfig): void;
}) {
  if (auth.type === "none") return null;
  if (auth.type === "bearer") {
    const folderTokenReference = folderAccessTokenVariable
      ? `{{${folderAccessTokenVariable}}}`
      : undefined;
    return (
      <div className="auth-token-field">
        <label className="field">
          <span>Token</span>
          <input
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
    );
  }
  if (auth.type === "basic") {
    return (
      <>
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
