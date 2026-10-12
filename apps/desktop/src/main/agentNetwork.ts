import { app } from "electron";
import { startNetworkHost } from "../../../../packages/agent/src/networkTransport";
import { dispatchAgentCall, setAgentHostAvailable } from "./agentDesktop";
import { sendAgentRequest } from "./agentExecution";

export async function installAgentNetworkHost(): Promise<() => Promise<void>> {
  const close = await startNetworkHost(app.getPath("userData"), sendAgentRequest, dispatchAgentCall);
  setAgentHostAvailable(true);
  return async () => { setAgentHostAvailable(false); await close(); };
}
