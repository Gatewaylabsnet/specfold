import { createInterface } from "node:readline/promises";
import { AgentError } from "./errors";
import { readBoundedFile } from "./repository";
import type { AgentService } from "./service";

export const HELP = `Specfold local agent (saved data only)
  list
  inspect --collection ID --request ID
  preview --file openapi.json [--base-url URL] [--collection ID] [--apinizer]
  diff --plan PLAN_ID
  bind-bearer --collection ID --variable NAME [--request ID | --folder ID]
  apinizer --collection ID [--base-url URL]
  validate --collection ID
  approve --plan PLAN_ID --revision REVISION  (interactive human approval)
  apply --plan PLAN_ID --revision REVISION    (requires --allow-apply and approval)
  send --collection ID --request ID          (requires --allow-network + desktop native consent)
  mcp                                       (stdio MCP transport)
Global: --data-dir DIRECTORY (required), --allow-apply and --allow-network (off by default)
Only reads saved workspace.json. Close desktop before apply. No token arguments.`;

export function parseArguments(argv: string[]): { command: string; options: Record<string, string | true> } {
  const options: Record<string, string | true> = Object.create(null);
  let command = "help";
  const flags = new Set(["apinizer", "allow-apply", "allow-network", "help"]);
  const valued = new Set(["data-dir", "collection", "request", "folder", "file", "base-url", "variable", "plan", "revision"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (flags.has(name)) options[name] = true;
      else if (valued.has(name) && argv[i + 1] && !argv[i + 1].startsWith("--")) options[name] = argv[++i];
      else throw new AgentError("INVALID_ARGUMENTS");
    } else if (command === "help") command = arg;
    else throw new AgentError("INVALID_ARGUMENTS");
  }
  return { command, options };
}

export async function runCli(service: AgentService, command: string, options: Record<string, string | true>): Promise<unknown> {
  const required = (key: string): string => {
    if (typeof options[key] !== "string" || !options[key]) throw new AgentError("INVALID_ARGUMENTS");
    return options[key] as string;
  };
  const optional = (key: string) => typeof options[key] === "string" ? options[key] as string : undefined;
  switch (command) {
    case "list": return service.listCollections();
    case "inspect": return service.inspectRequest(required("collection"), required("request"));
    case "preview": return service.preview({ kind: "import-openapi", text: await readBoundedFile(required("file"), 4 * 1024 * 1024),
      baseUrl: optional("base-url"), targetCollectionId: optional("collection"), apinizer: options.apinizer === true });
    case "diff": return service.showDiff(required("plan"));
    case "bind-bearer": return service.preview({ kind: "bind-bearer", collectionId: required("collection"),
      variableName: required("variable"), requestId: optional("request"), folderId: optional("folder") });
    case "apinizer": return service.preview({ kind: "create-apinizer", collectionId: required("collection"), baseUrl: optional("base-url") });
    case "validate": return service.validateCollection(required("collection"));
    case "apply": return service.apply(required("plan"), required("revision"));
    case "send": return service.sendRequest(required("collection"), required("request"));
    case "approve": {
      if (!process.stdin.isTTY || !process.stderr.isTTY) throw new AgentError("APPROVAL_REQUIRED");
      const plan = required("plan"), revision = required("revision");
      const diff = await service.showDiff(plan);
      process.stderr.write(`${JSON.stringify(diff, null, 2)}\n`);
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const challenge = `APPLY ${plan.slice(0, 12)}`;
        const answer = await reader.question(`Approve these changes? Type ${challenge}: `);
        if (answer !== challenge) throw new AgentError("APPROVAL_REQUIRED");
        return service.approve(plan, revision);
      } finally { reader.close(); }
    }
    default: throw new AgentError("INVALID_ARGUMENTS");
  }
}
