import { isAbsolute, relative, resolve } from "node:path";

export function resolveRendererAssetPath(
  rendererRoot: string,
  requestPathname: string
): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPathname);
  } catch {
    return undefined;
  }
  const relativePath = decodedPath.replace(/^[/\\]+/, "") || "index.html";
  const target = resolve(rendererRoot, relativePath);
  const pathFromRoot = relative(rendererRoot, target);
  if (
    pathFromRoot === "" ||
    pathFromRoot.startsWith(`..`) ||
    isAbsolute(pathFromRoot)
  ) {
    return undefined;
  }
  return target;
}
