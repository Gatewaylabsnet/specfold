import { useEffect, useState } from "react";
import { flattenRequests, type Workspace } from "@openapi-collection-studio/core";
import type { AgentConnectionInfo, AppSettings } from "../../../shared/contracts";

export function AIConnections({ settings, onChange, workspace }: {
  settings: AppSettings; onChange(patch: Partial<AppSettings>): void; workspace?: Workspace;
}) {
  const [info, setInfo] = useState<AgentConnectionInfo>();
  const [client, setClient] = useState("json");
  const [collectionId, setCollectionId] = useState(workspace?.collections[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const collection = workspace?.collections.find((item) => item.id === collectionId);
  const requests = collection ? flattenRequests(collection).map(({ request }) => request) : [];
  const refresh = () => { void window.studio.getAgentConnection?.().then(setInfo).catch(() => undefined); };
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    const unsubscribe = window.studio.onAgentEvent?.(refresh);
    return () => { window.clearInterval(timer); unsubscribe?.(); };
  }, [settings]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not complete the operation."); }
    finally { setBusy(false); refresh(); }
  };
  const configuration = info ? client === "codex"
    ? `[mcp_servers.specfold]\ncommand = ${JSON.stringify(info.configuration.command)}\nargs = ${JSON.stringify(info.configuration.args)}\nenv = { ELECTRON_RUN_AS_NODE = "1" }\n`
    : JSON.stringify({ mcpServers: { specfold: info.configuration } }, null, 2) : "";
  return <section className="ai-connections" aria-labelledby="ai-connections-title">
    <h3 id="ai-connections-title">AI connections</h3>
    <p>Connect your AI client to inspect collections, propose changes and prepare documentation. Review changes here before they are applied.</p>
    <label className="check-row"><input type="checkbox" checked={settings.agentEnabled === true}
      onChange={(event) => onChange({ agentEnabled: event.target.checked })} /><span>Enable AI connections</span></label>
    {settings.agentEnabled && <>
      <p role="status">{info?.available ? "Specfold is ready for connections." : "The local connection is unavailable. Restart Specfold and try again."}
        {info?.lastConnectedAt && ` Last connection: ${new Date(info.lastConnectedAt).toLocaleTimeString()}.`}</p>
      <label className="field"><span>AI client configuration</span><select value={client} onChange={(event) => setClient(event.target.value)}>
        <option value="json">JSON MCP clients</option><option value="codex">Codex (TOML)</option></select></label>
      <div className="button-row">
        <button className="secondary-button" disabled={busy || !configuration} onClick={() => void run(async () => {
          await navigator.clipboard.writeText(configuration); setMessage("Configuration copied. Add it to your AI client's MCP settings, then keep Specfold open.");
        })} type="button">Copy configuration</button>
        <button className="secondary-button" disabled={busy} onClick={() => void run(async () => {
          const result = await window.studio.testAgentConnection(); setMessage(result.message);
        })} type="button">{busy ? "Working…" : "Test connection"}</button>
      </div>
      <details><summary>View configuration</summary><pre className="agent-config">{configuration}</pre></details>
      <p>The bundled helper uses Specfold's runtime. Your AI client may send the returned API structure to its model provider; choose a client you trust.</p>
      <label className="check-row"><input type="checkbox" checked={settings.agentNetworkEnabled === true}
        onChange={(event) => onChange({ agentNetworkEnabled: event.target.checked })} /><span>Allow agents to send requests and read masked responses</span></label>
      {settings.agentNetworkEnabled && <>
        <label className="field"><span>Request permission</span><select value={settings.agentNetworkMode ?? "ask"}
          onChange={(event) => onChange({ agentNetworkMode: event.target.value as "ask" | "session" })}>
          <option value="ask">Ask before each request</option><option value="session">Approve selected requests for this session</option></select></label>
        {settings.agentNetworkMode === "session" && <>
          <label className="field"><span>Collection for this session</span><select value={collectionId} onChange={(event) => { setCollectionId(event.target.value); setSelected([]); setDraft(""); }}>
            <option value="">Select a collection</option>{workspace?.collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <p>Environment: {workspace?.environments.find((item) => item.id === workspace.activeEnvironmentId)?.name ?? "Not configured"}. Select only requests you want the agent to run.</p>
          <div className="agent-request-list">{requests.map((request) => <label className="check-row" key={request.id}>
            <input type="checkbox" checked={selected.includes(request.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, request.id] : selected.filter((id) => id !== request.id))} />
            <span><code>{request.method}</code> {request.name}</span></label>)}</div>
          <button className="secondary-button" disabled={busy || !selected.length} onClick={() => void run(async () => {
            setInfo(await window.studio.startAgentSession({ collectionId, requestIds: selected })); setMessage("Selected requests approved for this temporary session.");
          })} type="button">Approve selected requests</button>
          <p>Permission lasts 15 minutes or 20 sends. Requests can modify server data, including POST requests.</p>
        </>}
        {info?.session && <div className="status-box" role="status">Session: {info.session.collectionName} · {info.session.environmentName} · {info.session.remaining} sends left
          <button className="secondary-button" onClick={() => void run(async () => { await window.studio.stopAgentSession(); setMessage("Session stopped."); })} type="button">Stop session</button></div>}
      </>}
      <p>Tokens stay inside Specfold. Common personal fields in responses are masked; use test data for sensitive APIs.</p>
      {workspace && workspace.collections.length > 0 && <div className="agent-documentation">
        <label className="field"><span>Documentation collection</span><select value={collectionId} onChange={(event) => { setCollectionId(event.target.value); setSelected([]); setDraft(""); }}>
          <option value="">Select a collection</option>{workspace.collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="secondary-button" disabled={busy || !collectionId} onClick={() => void run(async () => {
          setDraft(await window.studio.previewAgentDocumentation(collectionId));
        })} type="button">Preview documentation draft</button>
        {draft && <><pre className="agent-config agent-documentation-preview" aria-label="Documentation draft">{draft}</pre>
        <button className="secondary-button" disabled={busy || !collectionId} onClick={() => void run(async () => {
          const result = await window.studio.exportAgentDocumentation(collectionId);
          setMessage(result.canceled ? "Export canceled." : "Documentation draft saved. Review observed and untested behavior before publishing.");
        })} type="button">Export documentation draft</button></>}
        <p>Includes redacted examples from approved sends in this app session. Untested requests are marked.</p>
      </div>}
    </>}
    {message && <div className="status-box" role="status">{message}</div>}
  </section>;
}
