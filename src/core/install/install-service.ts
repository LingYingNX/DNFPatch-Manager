import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import type { DataRoot, GameRoot, LibraryRoot } from "../../main/app-paths";
import type { Result } from "../../shared/result";
import {
  executeFileTransaction,
  type FileTransactionError,
  type FileTransactionStep,
} from "../filesystem/file-transaction";
import type { VirtualGroupService } from "../groups/group-service";
import type { StateStoreError } from "../state/atomic-json-store";
import {
  type DisableInstallItemsPlan,
  disableInstallItems,
  prepareDisableInstallItems,
} from "./disable-install-items";
import { enableInstallItems } from "./enable-install-items";
import type { InstallSourceError } from "./install-sources";
import { createInstallationStateStore } from "./installation-state";
import {
  prepareRelocateInstallations,
  type RelocateInstallationRequest,
  type RelocateInstallationsPlan,
  relocateInstallations,
} from "./relocate-installation";

type InstallServiceOptions = {
  readonly libraryRoot: LibraryRoot;
  readonly dataRoot: DataRoot;
  readonly gameRoot: GameRoot;
  readonly imageTargetDir?: string | undefined;
  readonly soundTargetDir?: string | undefined;
  readonly videoTargetDir?: string | undefined;
  readonly groups?: VirtualGroupService | undefined;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly executeTransaction?: FileTransactionExecutor;
};

export type InstallItem =
  | { readonly kind: "patch"; readonly relativePath: string }
  | { readonly kind: "group"; readonly groupId: string };

export type FileTransactionExecutor = (
  steps: readonly FileTransactionStep[],
) => ReturnType<typeof executeFileTransaction>;

export type InstallServiceError =
  | InstallSourceError
  | FileTransactionError
  | StateStoreError
  | { readonly code: "ALREADY_ENABLED"; readonly relativePath: string }
  | { readonly code: "DUPLICATE_ITEM"; readonly relativePath: string }
  | { readonly code: "TARGET_CONFLICT"; readonly targetPath: string }
  | { readonly code: "TARGET_MISSING"; readonly targetPath: string }
  | { readonly code: "TARGET_MODIFIED"; readonly targetPath: string }
  | { readonly code: "INSTALL_IO" };

export interface InstallService {
  prepareDisableMany(
    items: readonly InstallItem[],
  ): Promise<Result<DisableInstallItemsPlan, InstallServiceError>>;
  prepareRelocateMany(
    requests: readonly RelocateInstallationRequest[],
  ): Promise<Result<RelocateInstallationsPlan, InstallServiceError>>;
  enableMany(
    items: readonly InstallItem[],
  ): Promise<Result<{ readonly installedCount: number }, InstallServiceError>>;
  disableMany(
    items: readonly InstallItem[],
  ): Promise<Result<{ readonly removedCount: number }, InstallServiceError>>;
  enable(
    request: InstallItem,
  ): Promise<Result<{ readonly installedCount: number }, InstallServiceError>>;
  disable(
    request: InstallItem,
  ): Promise<Result<{ readonly removedCount: number }, InstallServiceError>>;
  relocateMany(
    requests: readonly RelocateInstallationRequest[],
  ): Promise<Result<{ readonly updatedCount: number }, InstallServiceError>>;
  relocate(
    request: RelocateInstallationRequest,
  ): Promise<Result<{ readonly updatedCount: number }, InstallServiceError>>;
}

export function createInstallService(options: InstallServiceOptions): InstallService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const stateFile = win32.join(options.dataRoot, "installation-state.json");
  const store = createInstallationStateStore(stateFile);
  const imageTargetDir = options.imageTargetDir ?? win32.join(options.gameRoot, "ImagePacks2");
  const soundTargetDir = options.soundTargetDir ?? win32.join(options.gameRoot, "SoundPacks");
  const videoTargetDir = options.videoTargetDir ?? win32.join(options.gameRoot, "video");
  const context = {
    libraryRoot: options.libraryRoot,
    dataRoot: options.dataRoot,
    gameRoot: options.gameRoot,
    imageTargetDir,
    soundTargetDir,
    videoTargetDir,
    groups: options.groups,
    stateFile,
    store,
    createId,
    now,
    executeTransaction: options.executeTransaction ?? executeFileTransaction,
  };

  return {
    prepareDisableMany: (items) => prepareDisableInstallItems(context, items),
    prepareRelocateMany: (requests) => prepareRelocateInstallations(context, requests),
    enableMany: (items) => enableInstallItems(context, items),
    disableMany: (items) => disableInstallItems(context, items),
    enable(request) {
      return enableInstallItems(context, [request]);
    },
    disable(request) {
      return disableInstallItems(context, [request]);
    },
    relocateMany(requests) {
      return relocateInstallations(context, requests);
    },
    relocate(request) {
      return relocateInstallations(context, [request]);
    },
  };
}

export type InstallBatchContext = {
  readonly libraryRoot: LibraryRoot;
  readonly dataRoot: DataRoot;
  readonly gameRoot: GameRoot;
  /** 贴图补丁落盘目录（游戏根目录下的 ImagePacks2）。 */
  readonly imageTargetDir: string;
  /** 音效补丁落盘目录（游戏根目录下的 SoundPacks）。 */
  readonly soundTargetDir: string;
  /** 视频补丁落盘目录（游戏根目录下的 video）。 */
  readonly videoTargetDir: string;
  readonly groups?: VirtualGroupService | undefined;
  readonly stateFile: string;
  readonly store: ReturnType<typeof createInstallationStateStore>;
  readonly createId: () => string;
  readonly now: () => Date;
  readonly executeTransaction: FileTransactionExecutor;
};
