export interface ReleaseVersion {
  value: string;
  core: [string, string, string];
  prerelease: string[];
}

const numeric = /^[0-9]+$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Strict SemVer, with the optional v prefix used by GitHub release tags. */
export function parseReleaseVersion(input: unknown): ReleaseVersion | undefined {
  if (typeof input !== "string" || input.length > 256) return undefined;
  const value = input.trim().replace(/^v/i, "");
  const match = versionPattern.exec(value);
  if (!match) return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => numeric.test(part) && part.length > 1 && part.startsWith("0"))) return undefined;
  return { value, core: [match[1], match[2], match[3]], prerelease };
}

const compareText = (left: string, right: string): -1 | 0 | 1 => left === right ? 0 : left < right ? -1 : 1;
// Compare decimal strings without truncation, rounding or a safe-integer limit.
const compareNumeric = (left: string, right: string): -1 | 0 | 1 => left.length === right.length
  ? compareText(left, right) : left.length < right.length ? -1 : 1;

/** Build metadata has no precedence. Malformed versions never imply an update. */
export function compareReleaseVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const a = parseReleaseVersion(left), b = parseReleaseVersion(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < a.core.length; index++) {
    const result = compareNumeric(a.core[index], b.core[index]);
    if (result) return result;
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length
    ? 0 : a.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const leftPart = a.prerelease[index], rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    const leftNumeric = numeric.test(leftPart), rightNumeric = numeric.test(rightPart);
    const result = leftNumeric && rightNumeric ? compareNumeric(leftPart, rightPart)
      : leftNumeric !== rightNumeric ? leftNumeric ? -1 : 1 : compareText(leftPart, rightPart);
    if (result) return result;
  }
  return 0;
}
