import { AgentRepository } from "./repository";
import { AgentService } from "./service";
import { startMcp } from "./mcp";
import { safeAgentError } from "./errors";

// Bundled with dependencies; runs using the desktop's existing Node runtime.
// It only calls the desktop owner and never writes/decrypts workspace data.
const index = process.argv.indexOf("--data-dir");
const root = index >= 0 ? process.argv[index + 1] : undefined;
if (!root) {
  process.stderr.write(`${JSON.stringify(safeAgentError(new Error("DATA_DIRECTORY_REQUIRED")))}\n`);
  process.exitCode = 1;
} else {
  void startMcp(new AgentService(new AgentRepository(root), false, true, true)).catch((error) => {
    process.stderr.write(`${JSON.stringify(safeAgentError(error))}\n`);
    process.exitCode = 1;
  });
}
