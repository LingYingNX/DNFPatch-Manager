import { copyFile, lstat, rm } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { err, ok, type Result } from "../../shared/result";
import {
  executeFileTransaction,
  type FileTransactionError,
  type FileTransactionStep,
} from "../filesystem/file-transaction";
import { hashFile } from "../filesystem/hash-file";
import { pathExists } from "../filesystem/path-exists";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";

export type ImportPatchesRequest = {
  readonly libraryRoot: LibraryRoot;
  readonly categoryRelativePath: string;
  readonly sourcePaths: readonly string[];
};

export type ImportPatchesResult = {
  readonly importedRelativePaths: readonly string[];
  readonly duplicateRelativePaths: readonly string[];
};

export type ImportPatchesError =
  | LibraryPathError
  | FileTransactionError
  | { readonly code: "INVALID_IMPORT_SOURCE"; readonly sourcePath: string }
  | { readonly code: "TARGET_CONFLICT"; readonly relativePath: string }
  | { readonly code: "IMPORT_IO" };

type ImportCandidate = {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly relativePath: string;
};

export async function importPatches(
  request: ImportPatchesRequest,
): Promise<Result<ImportPatchesResult, ImportPatchesError>> {
  const seenNames = new Set<string>();
  const candidates: ImportCandidate[] = [];

  try {
    for (const sourcePath of request.sourcePaths) {
      const name = win32.basename(sourcePath);
      const normalizedName = name.toLocaleLowerCase();
      if (
        !win32.isAbsolute(sourcePath) ||
        !isLibraryPatchPath(sourcePath) ||
        seenNames.has(normalizedName)
      ) {
        return err({ code: "INVALID_IMPORT_SOURCE", sourcePath });
      }
      const metadata = await lstat(sourcePath);
      if (!metadata.isFile()) {
        return err({ code: "INVALID_IMPORT_SOURCE", sourcePath });
      }
      seenNames.add(normalizedName);

      const relativePath = win32.join(request.categoryRelativePath, name);
      const target = resolveLibraryPath(request.libraryRoot, relativePath);
      if (!target.ok) {
        return target;
      }
      candidates.push({ sourcePath, targetPath: target.value, relativePath });
    }

    const importCandidates: ImportCandidate[] = [];
    const duplicateRelativePaths: string[] = [];
    for (const candidate of candidates) {
      if (!(await pathExists(candidate.targetPath))) {
        importCandidates.push(candidate);
        continue;
      }
      const [sourceHash, targetHash] = await Promise.all([
        hashFile(candidate.sourcePath),
        hashFile(candidate.targetPath),
      ]);
      if (sourceHash !== targetHash) {
        return err({ code: "TARGET_CONFLICT", relativePath: candidate.relativePath });
      }
      duplicateRelativePaths.push(candidate.relativePath);
    }

    const steps: FileTransactionStep[] = importCandidates.map(
      (candidate): FileTransactionStep => ({
        apply: () => copyFile(candidate.sourcePath, candidate.targetPath),
        compensate: () => rm(candidate.targetPath, { force: true }),
      }),
    );
    const transaction = await executeFileTransaction(steps);
    if (!transaction.ok) {
      return transaction;
    }

    return ok({
      importedRelativePaths: importCandidates.map((candidate) => candidate.relativePath),
      duplicateRelativePaths,
    });
  } catch (error) {
    if (error instanceof Error) {
      return err({ code: "IMPORT_IO" });
    }
    throw error;
  }
}
