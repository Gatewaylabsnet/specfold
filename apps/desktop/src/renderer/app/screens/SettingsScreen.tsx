import type { AppSettings } from "../types";
import { Download, Plus } from "lucide-react";

export function SettingsScreen({
  settings,
  onChange,
  workspaceName,
  onWorkspaceNameChange,
  onNewWorkspace,
  onExportBackup,
  onDeleteAllData,
  savedBackupPath
}: {
  settings: AppSettings;
  onChange(patch: Partial<AppSettings>): void;
  workspaceName: string;
  onWorkspaceNameChange(name: string): void;
  onNewWorkspace(): void;
  onExportBackup(): void;
  onDeleteAllData(): void;
  savedBackupPath: string;
}) {
  return (
    <section className="settings-layout">
      <div className="pane">
        <div className="pane__header">
          <h2>Settings</h2>
        </div>
        <h3>Workspace</h3>
        <label className="field">
          <span>Workspace name</span>
          <input onChange={(event) => onWorkspaceNameChange(event.target.value)} value={workspaceName} />
        </label>
        <button className="secondary-button" onClick={onNewWorkspace} type="button">
          <Plus size={16} />
          New workspace
        </button>
        <button className="secondary-button" onClick={onExportBackup} type="button">
          <Download size={16} />
          Export complete backup
        </button>
        {savedBackupPath && <div className="status-box">Saved to {savedBackupPath}</div>}
        <h3>Requests</h3>
        <label className="field">
          <span>Request timeout (ms)</span>
          <input
            min={0}
            onChange={(event) =>
              onChange({ requestTimeoutMs: Math.max(0, Number(event.target.value) || 0) })
            }
            type="number"
            value={settings.requestTimeoutMs}
          />
        </label>
        <label className="field">
          <span>Max response size (MB)</span>
          <input
            min={1}
            onChange={(event) =>
              onChange({
                maxResponseBytes: Math.max(1, Number(event.target.value) || 1) * 1024 * 1024
              })
            }
            type="number"
            value={Math.round(settings.maxResponseBytes / (1024 * 1024))}
          />
        </label>
        <label className="check-row">
          <input
            checked={settings.allowInsecureTls}
            onChange={(event) => onChange({ allowInsecureTls: event.target.checked })}
            type="checkbox"
          />
          <span>Allow insecure TLS (self-signed / internal CA certificates)</span>
        </label>
        {settings.allowInsecureTls && (
          <div className="status-box status-box--warning">
            TLS certificate verification is disabled for outgoing requests. Only enable this on trusted internal networks.
          </div>
        )}
        <div className="danger-zone">
          <h3>Delete local data</h3>
          <p>
            Permanently removes collections, requests, environments, secrets, settings, and local backups from this device.
          </p>
          <button className="danger-button" onClick={onDeleteAllData} type="button">
            Delete all local data
          </button>
        </div>
      </div>
    </section>
  );
}
