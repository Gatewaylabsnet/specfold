export class AgentError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const messages: Record<string, string> = {
  WORKSPACE_BUSY: "Workspace has a writer lease. Close Specfold before applying an agent plan. No data was changed.",
  WORKSPACE_NOT_FOUND: "Open and save a workspace in Specfold first, or select an existing profile with --data-dir.",
  INVALID_WORKSPACE: "Workspace is malformed or unsupported. No recovery, overwrite or import was attempted.",
  REVISION_CONFLICT: "Workspace changed since preview. Generate a new preview and approve that exact revision.",
  APPROVAL_REQUIRED: "A human must approve this plan using the interactive CLI approve command.",
  WRITES_DISABLED: "MCP writes are disabled. Restart with --allow-apply, then approve the exact plan in the CLI.",
  INVALID_PLAN: "Plan is missing, expired, modified, or belongs to a different workspace.",
  NETWORK_DISABLED: "Agent networking is off by default. Requires --allow-network, desktop Settings opt-in, and native consent per request.",
  DESKTOP_REQUIRED: "Open the updated Specfold desktop to request approved network execution. No request was sent.",
  NETWORK_APPROVAL_DENIED: "The user did not approve this network request. Nothing was sent.",
  REQUEST_CONFIGURATION_REQUIRED: "Configure the request and its referenced variables in Specfold before requesting execution.",
  NETWORK_BUSY: "Another agent request is awaiting consent or executing. Try again after it finishes.",
  PLAN_LIMIT: "This profile has 128 stored plans. Close all agent processes and remove old .agent plan/approval/receipt files before creating more.",
  COLLECTION_NOT_FOUND: "Collection ID was not found in the saved workspace.",
  REQUEST_NOT_FOUND: "Request ID was not found in the selected collection.",
  FOLDER_NOT_FOUND: "Folder ID was not found in the selected collection.",
  INVALID_ARGUMENTS: "Command arguments are invalid. Run help for supported options; credentials are never accepted as arguments.",
  INVALID_ENCODING: "Input must be a valid UTF-8 document. No replacement or overwrite was attempted.",
  INVALID_TARGET: "Select either a folder or a request, not both.",
  INVALID_API_BASE_URL: "Use a concrete HTTP(S) API URL without credentials, query parameters or fragments.",
  IPC_UNAUTHORIZED: "The local IPC capability is invalid. Restart the updated desktop and try again.",
  IPC_INVALID_RESPONSE: "The local desktop did not return a valid response.",
  NETWORK_TIMEOUT: "Local network execution did not finish within the consent/execution timeout.",
  DATA_DIRECTORY_REQUIRED: "Pass --data-dir with the exact local data folder shown in Specfold Settings.",
  INVALID_OPENAPI: "OpenAPI/Swagger input is invalid. Check the document locally; raw parser errors are not exposed.",
  UNSAFE_DATA_PATH: "A linked or unsafe data path was rejected.",
  UNPROTECTED_SECRET: "The saved workspace contains literal credentials. Mark environment credentials as Secret and save with secure storage available, or replace inline credentials with variable references, before agent writes.",
  INPUT_TOO_LARGE: "Input exceeds the local integration size limit.",
  INVALID_VARIABLE_NAME: "Use a variable name, never a token value (letters, digits, underscore, dot or dash).",
  API_BASE_URL_REQUIRED: "Set a concrete HTTP(S) collection API address before creating its Apinizer JWT recipe."
};

/** Never echo parser errors, raw arguments, document fragments, secrets or paths. */
export function safeAgentError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && Object.hasOwn(messages, error.message) ? error.message : "OPERATION_FAILED";
  return { code, message: messages[code] ?? "Operation could not be completed. Review IDs and input structure locally." };
}
