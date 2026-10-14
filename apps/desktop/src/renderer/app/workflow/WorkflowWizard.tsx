import { useEffect, useRef, useState } from "react";
import type { ConnectionProfile, WorkflowAuth, WorkflowRunReport, WorkflowTestPlan, Workspace } from "@openapi-collection-studio/core";
import type { AppSettings, WorkspaceLoadResult } from "../../../shared/contracts";
import { AuthenticationStep } from "./AuthenticationStep";
import { ConnectionStep } from "./ConnectionStep";
import { PreviewStep } from "./PreviewStep";
import { ResultsStep } from "./ResultsStep";
import { credentialFields, defaultAuth, newProfile, safeSaveError, safeSourceUrl, savedProfiles, validAuthentication, validConnection, type SourceChoice } from "./model";
import "./WorkflowWizard.css";

export interface WorkflowWizardProps {
  workspace: Workspace; settings: AppSettings; secureStorageAvailable: boolean;
  saveWorkspaceNow(): Promise<void>; replaceSavedWorkspace(result: WorkspaceLoadResult): void;
  onOpenSettings(): void; onClose(): void; onRunningChange(running: boolean): void;
  onDirtyChange?(dirty: boolean): void;
}

export function WorkflowWizard({ workspace, settings, secureStorageAvailable, saveWorkspaceNow, replaceSavedWorkspace,
  onOpenSettings, onClose, onRunningChange, onDirtyChange }: WorkflowWizardProps) {
  const [profile, setProfile] = useState(() => newProfile(workspace));
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [sourceText, setSourceText] = useState<string>();
  const [sourceUrl, setSourceUrl] = useState("");
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<WorkflowTestPlan>();
  const [report, setReport] = useState<WorkflowRunReport>();
  const [busy, setBusy] = useState<"source" | "save" | "preview" | "run" | "export" | "reload">();
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const selectedIds = useRef<string[] | undefined>(undefined);
  const runningRef = useRef(false);
  const savedId = useRef<string>();
  const running = busy === "run";
  useEffect(() => { onRunningChange(!!busy); }, [busy, onRunningChange]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (runningRef.current || dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => () => {
    if (runningRef.current) void window.studio.cancelWorkflowRun().catch(() => undefined);
  }, []);

  function changeProfile(next: ConnectionProfile) {
    if (next.auth.kind === "apinizer" && next.baseUrl !== profile.baseUrl) {
      const previousDefault = defaultAuth("apinizer", profile.baseUrl, profile.id);
      const nextDefault = defaultAuth("apinizer", next.baseUrl, next.id);
      if (previousDefault.kind === "apinizer" && nextDefault.kind === "apinizer" && (!next.auth.endpoint || next.auth.endpoint === previousDefault.endpoint)) {
        next = { ...next, auth: { ...next.auth, endpoint: nextDefault.endpoint } };
      }
    }
    if (next.auth.kind !== profile.auth.kind || next.environmentId !== profile.environmentId) setCredentials({});
    setProfile(next); setDirty(true); setPlan(undefined); setError(undefined);
  }
  function changeAuth(auth: WorkflowAuth) { changeProfile({ ...profile, auth }); }
  function loadProfile(id: string) {
    if (dirty && !window.confirm("Discard the unsaved changes in this workflow? Stored profiles and credentials are kept.")) return;
    const saved = savedProfiles(workspace).find((item) => item.id === id);
    setProfile(saved ? structuredClone(saved) : newProfile(workspace));
    setCredentials({}); setSourceText(undefined); setSourceUrl(saved?.source.kind === "url" ? saved.source.label : "");
    setPlan(undefined); setReport(undefined); setError(undefined); setDirty(false); savedId.current = saved?.id; selectedIds.current = undefined;
  }
  function changeSource(kind: SourceChoice) {
    if (kind === profile.source.kind) return;
    const collection = workspace.collections.find((item) => item.id === profile.collectionId) ?? workspace.collections[0];
    changeProfile({ ...profile, collectionId: kind === "existing" ? collection?.id ?? "" : "",
      source: { kind, label: kind === "existing" ? collection?.name ?? "Existing collection" : "" } });
    setSourceText(undefined); setSourceUrl("");
  }
  async function openFile() {
    setBusy("source"); setError(undefined);
    try {
      const result = await window.studio.openImportFile();
      if (result.canceled) return;
      if (result.error || !result.content) throw new Error("Import unavailable");
      setSourceText(result.content);
      changeProfile({ ...profile, source: { kind: "file", label: result.filePath?.split(/[\\/]/).pop() ?? "OpenAPI file" } });
    } catch { setError("Could not load the specification. Choose a readable OpenAPI file and try again."); }
    finally { setBusy(undefined); }
  }
  async function fetchSource() {
    setBusy("source"); setError(undefined);
    try {
      const url = safeSourceUrl(sourceUrl);
      const result = await window.studio.fetchImportUrl(url);
      if (!result.ok || !result.content) throw new Error("Import unavailable");
      setSourceText(result.content); changeProfile({ ...profile, source: { kind: "url", label: url } });
    } catch { setError("Could not load the specification URL. Use an HTTP or HTTPS URL without credentials or secret query parameters, and check access."); }
    finally { setBusy(undefined); }
  }
  async function preview(profileId: string, ids = selectedIds.current) {
    setBusy("preview"); setError(undefined); setStep(2);
    try {
      const next = ids === undefined ? await window.studio.previewWorkflowRun(profileId) : await window.studio.previewWorkflowRun(profileId, ids);
      setPlan(next);
    } catch {
      setPlan(undefined); setError("Could not prepare the test preview. Your saved profile is unchanged. Try again.");
    } finally { setBusy(undefined); }
  }
  async function save() {
    if (busy) return;
    setBusy("save"); setError(undefined); setPlan(undefined);
    try {
      await saveWorkspaceNow();
      const current = await window.studio.loadWorkspace();
      if (typeof current.generation !== "number") throw new Error("Workspace revision unavailable");
      const values = Object.fromEntries(credentialFields(profile.auth).filter((field) => credentials[field.variable]).map((field) => [field.variable, credentials[field.variable]]));
      const result = await window.studio.saveWorkflowProfile({ profile, sourceText, credentials: values, expectedGeneration: current.generation });
      replaceSavedWorkspace(result); setCredentials({}); setSourceText(undefined); setDirty(false);
      const saved = savedProfiles(result.workspace).find((item) => item.id === result.profileId);
      if (saved) setProfile(structuredClone(saved));
      savedId.current = result.profileId; selectedIds.current = undefined;
      await preview(result.profileId);
    } catch (error) { setError(safeSaveError(error)); }
    finally { setBusy(undefined); }
  }
  function toggle(id: string, selected: boolean) {
    if (!plan || busy || !savedId.current) return;
    selectedIds.current = plan.rows.filter((row) => row.status === "ready" && (row.requestId === id ? selected : row.selected)).map((row) => row.requestId);
    void preview(savedId.current, selectedIds.current);
  }
  async function run() {
    const count = plan?.rows.filter((row) => row.selected && row.status === "ready").length ?? 0;
    if (busy || !plan || !count || count > (profile.auth.kind === "apinizer" ? 19 : 20)) return;
    setBusy("run"); setError(undefined); setCanceling(false); runningRef.current = true;
    try { setReport(await window.studio.runWorkflowPlan(plan.id)); setStep(3); }
    catch { setPlan(undefined); setError("The run could not finish. Prepare a fresh preview before retrying. Requests already sent may have changed server data."); }
    finally { runningRef.current = false; setBusy(undefined); setCanceling(false); }
  }
  async function cancel() {
    if (!runningRef.current || canceling) return;
    setCanceling(true);
    try { await window.studio.cancelWorkflowRun(); }
    catch { setCanceling(false); setError("Cancellation could not be confirmed. Try canceling again and wait for the run to stop."); }
  }
  async function exportReport() {
    if (!report || busy) return;
    setBusy("export"); setError(undefined);
    try { await window.studio.saveExportFile(`specfold-workflow-${report.id}.json`, JSON.stringify(report, null, 2)); }
    catch { setError("Could not export the report. Try saving it to another location."); }
    finally { setBusy(undefined); }
  }
  async function reloadReport() {
    if (!report || busy) return;
    setBusy("reload"); setError(undefined);
    try {
      const saved = await window.studio.getWorkflowReport(report.id);
      if (!saved) throw new Error("Report unavailable");
      setReport(saved);
    } catch { setError("The saved report is unavailable. The current report remains visible."); }
    finally { setBusy(undefined); }
  }
  return <div className="workflow">
    <div className="workflow-heading"><div><h1>Test workflow</h1><p>Connect an API, set authentication, review tests, and inspect the results.</p></div>
      <button className="secondary-button" type="button" disabled={!!busy} onClick={onClose}>Back to editor</button></div>
    <ol className="workflow-steps" aria-label="Workflow steps">{["Connection", "Authentication", "Test preview", "Results"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <details className="workflow-settings"><summary>MCP settings: {settings.agentEnabled ? "enabled" : "disabled"}; network access: {settings.agentNetworkEnabled ? "enabled" : "disabled"}</summary>
      <p>This manual desktop workflow uses native consent. It does not change MCP or network permissions.</p><button className="secondary-button" type="button" disabled={!!busy} onClick={onOpenSettings}>Open Settings</button></details>
    {error && <p role="alert" className="workflow-error">{error}</p>}
    <div className="workflow-card"><fieldset className="workflow-fields" disabled={!!busy && step < 2}>
      {step === 0 && <ConnectionStep workspace={workspace} profile={profile} sourceText={sourceText} sourceUrl={sourceUrl} busy={!!busy}
        onProfile={changeProfile} onLoadProfile={loadProfile} onSource={changeSource} onUrl={(value) => { setSourceUrl(value); setSourceText(undefined); changeProfile({ ...profile, collectionId: "", source: { kind: "url", label: "" } }); }}
        onFile={() => void openFile()} onFetch={() => void fetchSource()} onContinue={() => { setStep(1); setError(undefined); }} canContinue={validConnection(profile, sourceText)} />}
      {step === 1 && <AuthenticationStep workspace={workspace} profile={profile} credentials={credentials} secureStorageAvailable={secureStorageAvailable} busy={!!busy}
        valid={validAuthentication(profile.auth) && (profile.auth.kind === "none" || secureStorageAvailable)} onAuth={changeAuth}
        onCredential={(variable, value) => { setCredentials((previous) => ({ ...previous, [variable]: value })); setDirty(true); }}
        onBack={() => { setStep(0); setError(undefined); }} onSave={() => void save()} />}
      {step === 2 && <PreviewStep plan={plan} baseUrl={profile.baseUrl} maxTests={profile.auth.kind === "apinizer" ? 19 : 20} busy={!!busy} running={running} canceling={canceling} onToggle={toggle}
        onBack={() => { setStep(1); setPlan(undefined); setError(undefined); }} onRetry={() => savedId.current && void preview(savedId.current)} onRun={() => void run()} onCancel={() => void cancel()} />}
      {step === 3 && report && <ResultsStep report={report} busy={!!busy} onPreview={() => { setPlan(undefined); if (savedId.current) void preview(savedId.current); }} onExport={() => void exportReport()} onReload={() => void reloadReport()} />}
    </fieldset></div>
  </div>;
}
