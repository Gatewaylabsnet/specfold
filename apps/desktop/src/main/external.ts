import { shell } from "electron";
import { trustedExternalUrl } from "./externalUrls";

export async function openTrustedExternal(url: string): Promise<void> {
  await shell.openExternal(trustedExternalUrl(url));
}
