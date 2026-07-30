const TRUSTED_EXTERNAL_HOSTS = new Set([
  "gatewaylabs.net",
  "www.gatewaylabs.net",
  "github.com"
]);

export function trustedExternalUrl(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !TRUSTED_EXTERNAL_HOSTS.has(parsed.hostname)
  ) {
    throw new Error("The external link is not on the Specfold allowlist.");
  }
  return parsed.toString();
}
