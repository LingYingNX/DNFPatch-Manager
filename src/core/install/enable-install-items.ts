import { COPYFILE_EXCL } from "node:constants";
import { copyFile, rm } from "node:fs/promises";
import { win32 } from "node:path";
import { err, ok, type Result } from "../../shared/result";
import type { FileTransactionStep } from "../filesystem/file-transaction";
import { hashFile } from "../filesystem/hash-file";
import { pathExists } from "../filesystem/path-exists";
import { normalizedPathKey } from "../paths/relative-path";
import type { InstallationRecord, InstallationState } from "../state/schemas";
import { rejectDuplicateItems } from "./install-item-identity";
import type { InstallBatchContext, InstallItem, InstallServiceError } from "./install-service";
import { type InstallSource, resolveInstallSources } from "./install-sources";
import { assertInstallTargetBoundary } from "./install-target-boundary";
import {
  readInstallationState,
  restoreInstallationState,
  writeInstallationState,
} from "./installation-state";
import { classifyNpk, type NpkPatchKind } from "./npk-type";

type EnableCandidate = {
  readonly source: InstallSource;
  readonly sourceHash: string;
  readonly targetPath: string;
};

export async function enableInstallItems(
  context: InstallBatchContext,
  items: readonly InstallItem[],
): Promise<Result<{ readonly installedCount: number }, InstallServiceError>> {
  const duplicates = rejectDuplicateItems(items);
  if (!duplicates.ok) return duplicates;
  const snapshot = await readInstallationState(context.store);
  if (!snapshot.ok) return snapshot;

  try {
    const candidates = await buildCandidates(context, items, snapshot.value.state.records);
    if (!candidates.ok) return candidates;
    const transactionId = context.createId();
    const enabledAt = context.now().toISOString();
    const records: InstallationRecord[] = candidates.value.map((candidate) => ({
      sourceRelativePath: candidate.source.sourceRelativePath,
      sourceHash: candidate.sourceHash,
      targetPath: candidate.targetPath,
      targetHash: candidate.sourceHash,
      enabledAt,
      transactionId,
    }));
    const nextState: InstallationState = {
      ...snapshot.value.state,
      records: [...snapshot.value.state.records, ...records],
    };
    const transaction = await context.executeTransaction([
      ...candidates.value.map(
        (candidate): FileTransactionStep => ({
          apply: () =>
            copyFileExclusive(context, candidate.source.sourcePath, candidate.targetPath),
          compensate: async () => {
            await assertInstallTargetBoundary(context.gameRoot, candidate.targetPath);
            await rm(candidate.targetPath, { force: true });
          },
        }),
      ),
      {
        apply: () => writeInstallationState(context.store, nextState),
        compensate: () =>
          restoreInstallationState(context.store, context.stateFile, snapshot.value),
      },
    ]);
    return transaction.ok ? ok({ installedCount: candidates.value.length }) : transaction;
  } catch (error) {
    if (error instanceof Error) return err({ code: "INSTALL_IO" });
    throw error;
  }
}

async function copyFileExclusive(
  context: InstallBatchContext,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await assertInstallTargetBoundary(context.gameRoot, targetPath);
  await copyFile(sourcePath, targetPath, COPYFILE_EXCL);
}

/**
 * 路由目标目录：按补丁类型选 ImagePacks2 / SoundPacks / video；
 * 子目录缺失（外部被删或旧测试环境）时回落 gameRoot 直属，不阻塞安装。
 */
async function resolveTargetDir(context: InstallBatchContext, kind: NpkPatchKind): Promise<string> {
  const routed =
    kind === "sound"
      ? context.soundTargetDir
      : kind === "video"
        ? context.videoTargetDir
        : context.imageTargetDir;
  return (await pathExists(routed)) ? routed : context.gameRoot;
}

async function buildCandidates(
  context: InstallBatchContext,
  items: readonly InstallItem[],
  records: readonly InstallationRecord[],
): Promise<Result<readonly EnableCandidate[], InstallServiceError>> {
  const sources: InstallSource[] = [];
  for (const item of items) {
    const resolved = await resolveInstallSources(context.libraryRoot, item, context.groups);
    if (!resolved.ok) return resolved;
    sources.push(...resolved.value);
  }

  const sourcePaths = new Set<string>();
  const targetNames = new Set<string>();
  const candidates: EnableCandidate[] = [];
  for (const source of sources) {
    const sourcePath = normalizedPathKey(source.sourceRelativePath);
    if (sourcePaths.has(sourcePath))
      return err({ code: "DUPLICATE_ITEM", relativePath: source.sourceRelativePath });
    sourcePaths.add(sourcePath);
    if (records.some((record) => record.sourceRelativePath === source.sourceRelativePath)) {
      return err({ code: "ALREADY_ENABLED", relativePath: source.sourceRelativePath });
    }
    const kind = await classifyNpk(source.sourcePath);
    const targetDir = await resolveTargetDir(context, kind);
    const targetPath = win32.join(targetDir, source.name);
    const targetName = win32.basename(targetPath).toLocaleLowerCase();
    if (targetNames.has(targetName) || (await pathExists(targetPath))) {
      return err({ code: "TARGET_CONFLICT", targetPath });
    }
    targetNames.add(targetName);
    candidates.push({ source, sourceHash: await hashFile(source.sourcePath), targetPath });
  }
  return ok(candidates);
}
