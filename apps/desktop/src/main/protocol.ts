import { net, protocol } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRendererAssetPath } from "./protocolPaths";

const APP_SCHEME = "specfold";
const APP_HOST = "app";

export function registerAppProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true
      }
    }
  ]);
}

export function installAppProtocol(): void {
  const rendererRoot = join(__dirname, "../renderer");
  protocol.handle(APP_SCHEME, (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== APP_HOST) {
      return new Response("Not found", { status: 404 });
    }
    const filePath = resolveRendererAssetPath(rendererRoot, requestUrl.pathname);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}
