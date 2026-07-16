import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { MAX_FOLDER_IMPORT_FILES, MAX_IMPORT_BYTES } from "./constants";

interface FolderImportFile {
  path: string;
  content: string;
}

export async function readPostmanV3Folder(rootPath: string): Promise<{
  rootName: string;
  files: FolderImportFile[];
  skippedScriptCount: number;
}> {
  const files: FolderImportFile[] = [];
  let totalBytes = 0;
  let discoveredFiles = 0;
  let skippedScriptCount = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 50) {
      throw new Error("The selected folder is nested too deeply to import safely.");
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = join(directory, entry.name);
      const relativePath = relative(rootPath, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) {
          continue;
        }
        await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      discoveredFiles += 1;
      if (discoveredFiles > MAX_FOLDER_IMPORT_FILES) {
        throw new Error(`The selected folder contains more than ${MAX_FOLDER_IMPORT_FILES} files.`);
      }
      if (/\.resources\/scripts\//i.test(relativePath)) {
        skippedScriptCount += 1;
        continue;
      }
      const isRequest = /\.request\.ya?ml$/i.test(relativePath);
      const isDefinition = /(?:^|\/)definition\.ya?ml$/i.test(relativePath);
      const isExample = /\.resources\/examples\/.*\.ya?ml$/i.test(relativePath);
      if (!isRequest && !isDefinition && !isExample) {
        continue;
      }
      const size = (await stat(fullPath)).size;
      totalBytes += size;
      if (totalBytes > MAX_IMPORT_BYTES) {
        throw new Error(
          `Postman folder content is larger than ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.`
        );
      }
      files.push({ path: relativePath, content: await readFile(fullPath, "utf8") });
    }
  };

  await visit(rootPath, 0);
  if (!files.some((file) => /\.request\.ya?ml$/i.test(file.path))) {
    throw new Error("No *.request.yaml files were found in the selected folder.");
  }
  return { rootName: basename(rootPath), files, skippedScriptCount };
}

