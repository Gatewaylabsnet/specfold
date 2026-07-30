export function isTrustedRendererUrl(
  candidateUrl: string,
  devServerUrl?: string
): boolean {
  try {
    const candidate = new URL(candidateUrl);
    if (devServerUrl) {
      return candidate.origin === new URL(devServerUrl).origin;
    }
    return (
      candidate.protocol === "specfold:" &&
      candidate.host === "app" &&
      candidate.pathname === "/index.html"
    );
  } catch {
    return false;
  }
}
