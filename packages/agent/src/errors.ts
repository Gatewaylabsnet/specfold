export class AgentError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const messages: Record<string, string> = {
  WORKSPACE_BUSY: "Another process owns the workspace. Use in-app review with --desktop, or close Specfold for offline apply. No data was changed.",
  WORKSPACE_NOT_FOUND: "Open and save a workspace in Specfold first, or select an existing profile with --data-dir.",
  INVALID_WORKSPACE: "Workspace is malformed or unsupported. No recovery, overwrite or import was attempted.",
  REVISION_CONFLICT: "Workspace changed since preview. Generate a new preview and approve that exact revision.",
  APPROVAL_REQUIRED: "Review and approve this change in Specfold, or use interactive CLI approval for offline apply.",
  WRITES_DISABLED: "Direct writes are disabled. Request review in Specfold. Advanced offline apply needs --allow-apply and prior interactive approval.",
  INVALID_PLAN: "Plan is missing, expired, modified, or belongs to a different workspace.",
  NETWORK_DISABLED: "Agent networking is off. Enable AI connections and request sending in Settings, then approve a request or selected-request session. Advanced CLI also needs --allow-network.",
  DESKTOP_REQUIRED: "Open the updated Specfold desktop and enable AI connections on this profile. No data was changed or request sent.",
  NETWORK_APPROVAL_DENIED: "The user did not approve this network request. Nothing was sent.",
  REQUEST_CONFIGURATION_REQUIRED: "Configure the request and its referenced variables in Specfold before requesting execution.",
  NETWORK_BUSY: "Another agent request is awaiting consent or executing. Try again after it finishes.",
  PLAN_LIMIT: "This profile has 128 stored plans. Close Specfold and agent clients, then remove obsolete .agent plan/approval/receipt files before creating more.",
  COLLECTION_NOT_FOUND: "Collection ID was not found in the saved workspace.",
  REQUEST_NOT_FOUND: "Request ID was not found in the selected collection.",
  FOLDER_NOT_FOUND: "Folder ID was not found in the selected collection.",
  INVALID_ARGUMENTS: "Command arguments are invalid. Run help for supported options; credentials are never accepted as arguments.",
  INVALID_ENCODING: "Input must be a valid UTF-8 document. No replacement or overwrite was attempted.",
  INVALID_TARGET: "Select either a folder or a request, not both.",
  INVALID_API_BASE_URL: "Use a concrete HTTP(S) API URL without credentials, query parameters or fragments.",
  IPC_UNAUTHORIZED: "The local IPC capability is invalid. Restart the updated desktop and try again.",
  IPC_INVALID_RESPONSE: "The local desktop did not return a valid response.",
  IPC_DISCONNECTED: "The desktop connection closed before a response was received. Check the request status before retrying.",
  OPERATION_CANCELLED: "The operation was cancelled. A request already sent to the remote server cannot be undone; check its status before retrying.",
  NETWORK_TIMEOUT: "Local network execution did not finish within the consent/execution timeout.",
  AGENT_DISABLED: "Enable AI connections in Specfold Settings, then test the connection again.",
  SESSION_REQUIRED: "Select requests and approve a temporary session in Specfold AI connections before sending.",
  SESSION_EXPIRED: "The temporary session ended or its approved requests changed. Approve a new session in Specfold.",
  REVIEW_NOT_FOUND: "Ask Specfold to review this plan before checking its status.",
  WORKSPACE_CHANGED: "Saved data changed. Reload the workspace and review your changes before saving again.",
  DATA_DIRECTORY_REQUIRED: "Pass --data-dir with the exact local data folder shown in Specfold Settings.",
  INVALID_OPENAPI: "OpenAPI/Swagger input is invalid. Check the document locally; raw parser errors are not exposed.",
  UNSAFE_DATA_PATH: "A linked or unsafe data path was rejected.",
  UNPROTECTED_SECRET: "The saved workspace contains literal credentials. Mark environment credentials as Secret and save with secure storage available, or replace inline credentials with variable references, before agent writes.",
  INPUT_TOO_LARGE: "Input or returned context exceeds the local integration size limit. Use a smaller document or inspect individual requests.",
  INVALID_VARIABLE_NAME: "Use a variable name, never a token value (letters, digits, underscore, dot or dash).",
  API_BASE_URL_REQUIRED: "Set a concrete HTTP(S) collection API address before creating its Apinizer JWT recipe.",
  WORKFLOW_PROFILE_NOT_FOUND: "Choose a saved connection profile from list_connection_profiles, or configure one in the desktop Test workflow.",
  WORKFLOW_PLAN_NOT_FOUND: "Preview a new test plan. Plans are consumed once, expire after fifteen minutes and are cleared when data changes.",
  WORKFLOW_REPORT_NOT_FOUND: "No retained report matches this run or plan ID. Reports are in memory for the last ten completed runs.",
  WORKFLOW_PLAN_LIMIT: "Too many active test previews. Wait for expiry or reopen Specfold, then preview only the intended selection.",
  WORKFLOW_ROW_LIMIT: "The selected collection exceeds the guided test plan limit of 500 requests. Use a smaller collection.",
  WORKFLOW_BUSY: "A guided test is awaiting consent or running. Finish or cancel it before starting another.",
  INVALID_WORKFLOW_ID: "Use the exact saved profile, plan or run ID returned by Specfold.",
  INVALID_WORKFLOW_SELECTION: "Choose unique saved request IDs within the guided run limit.",
  PLAN_EXPIRED: "This test plan expired. Generate a new preview and approve that exact selection."
};

/** Never echo parser errors, raw arguments, document fragments, secrets or paths. */
export function safeAgentError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && Object.hasOwn(messages, error.message) ? error.message : "OPERATION_FAILED";
  return { code, message: messages[code] ?? "Operation could not be completed. Review IDs and input structure locally." };
}
