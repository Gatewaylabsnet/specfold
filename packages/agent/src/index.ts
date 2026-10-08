import { AgentRepository } from "./repository";
import { AgentService } from "./service";
import { HELP, parseArguments, runCli } from "./cli";
import { safeAgentError } from "./errors";
import { startMcp } from "./mcp";

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "help" || options.help) process.stdout.write(`${HELP}\n`);
  else {
    if (typeof options["data-dir"] !== "string") throw new Error("DATA_DIRECTORY_REQUIRED");
    const service = new AgentService(new AgentRepository(options["data-dir"]), options["allow-apply"] === true, options["allow-network"] === true);
    if (command === "mcp") await startMcp(service);
    else process.stdout.write(`${JSON.stringify(await runCli(service, command, options), null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeAgentError(error))}\n`);
  process.exitCode = 1;
}
