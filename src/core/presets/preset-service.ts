import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import type {
  AddItemsToPresetRequest,
  CreatePresetRequest,
  DeletePresetRequest,
  PresetDto,
  PresetInstallResult,
  PresetItemReference,
  PresetSummary,
  RenamePresetRequest,
} from "../../shared/preset-contracts";
import { err, ok, type Result } from "../../shared/result";
import type { InstallService, InstallServiceError } from "../install/install-service";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";
import {
  type AtomicJsonStore,
  readOrFallback,
  type StateStoreError,
} from "../state/atomic-json-store";
import type { PresetState } from "./preset-state";

export type PresetServiceError =
  | StateStoreError
  | InstallServiceError
  | { readonly code: string }
  | LibraryPathError
  | { readonly code: "PRESET_NOT_FOUND"; readonly id: string }
  | { readonly code: "PRESET_NAME_CONFLICT"; readonly name: string }
  | { readonly code: "PRESET_ITEM_MISSING"; readonly relativePath: string }
  | { readonly code: "PRESET_ITEM_INVALID"; readonly relativePath: string }
  | { readonly code: "PRESET_IO" };

export type PresetService = {
  readonly list: () => Promise<Result<readonly PresetSummary[], PresetServiceError>>;
  readonly create: (
    request: CreatePresetRequest,
  ) => Promise<Result<PresetSummary, PresetServiceError>>;
  readonly rename: (
    request: RenamePresetRequest,
  ) => Promise<Result<PresetSummary, PresetServiceError>>;
  readonly remove: (
    request: DeletePresetRequest,
  ) => Promise<Result<{ readonly id: string }, PresetServiceError>>;
  readonly addItems: (
    request: AddItemsToPresetRequest,
  ) => Promise<Result<PresetSummary, PresetServiceError>>;
  readonly install: (id: string) => Promise<Result<PresetInstallResult, PresetServiceError>>;
};

type PresetServiceOptions = {
  readonly install?: InstallService;
  readonly getInstallService?: () => Result<InstallService, { readonly code: string }>;
  readonly libraryRoot: LibraryRoot;
  readonly store: AtomicJsonStore<PresetState>;
  readonly createId?: () => string;
  readonly now?: () => Date;
};

type ResolvedReference = {
  readonly reference: PresetItemReference;
  readonly path: string;
  readonly present: boolean;
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const value: unknown = Reflect.get(error, "code");
  return typeof value === "string" ? value : undefined;
}

function normalizePath(relativePath: string): string {
  return win32.normalize(relativePath.replaceAll("/", win32.sep));
}

function referenceKey(relativePath: string): string {
  return normalizePath(relativePath).toLocaleLowerCase();
}

function uniqueReferences(references: readonly PresetItemReference[]): PresetItemReference[] {
  const seen = new Set<string>();
  return references.flatMap((reference) => {
    const normalized: PresetItemReference = {
      kind: "patch",
      relativePath: normalizePath(reference.relativePath),
    };
    const key = referenceKey(normalized.relativePath);
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [normalized];
  });
}

export function createPresetService(options: PresetServiceOptions): PresetService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  const readState = async (): Promise<Result<PresetState, PresetServiceError>> =>
    readOrFallback(options.store, () => ({ formatVersion: 1, presets: [] }));

  const writeState = async (state: PresetState): Promise<Result<void, PresetServiceError>> =>
    options.store.write(state);

  const resolveReference = async (
    reference: PresetItemReference,
    allowMissing: boolean,
  ): Promise<Result<ResolvedReference, PresetServiceError>> => {
    const normalizedReference: PresetItemReference = {
      kind: "patch",
      relativePath: normalizePath(reference.relativePath),
    };
    const resolved = resolveLibraryPath(options.libraryRoot, normalizedReference.relativePath);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const metadata = await stat(resolved.value);
      if (!metadata.isFile() || !isLibraryPatchPath(normalizedReference.relativePath)) {
        return err({
          code: "PRESET_ITEM_INVALID",
          relativePath: normalizedReference.relativePath,
        });
      }
      return ok({ reference: normalizedReference, path: resolved.value, present: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return allowMissing
          ? ok({ reference: normalizedReference, path: resolved.value, present: false })
          : err({
              code: "PRESET_ITEM_MISSING",
              relativePath: normalizedReference.relativePath,
            });
      }
      if (error instanceof Error) {
        return err({ code: "PRESET_IO" });
      }
      throw error;
    }
  };

  const validateReferences = async (
    references: readonly PresetItemReference[],
  ): Promise<Result<PresetItemReference[], PresetServiceError>> => {
    const normalized: PresetItemReference[] = [];
    for (const reference of uniqueReferences(references)) {
      const resolved = await resolveReference(reference, false);
      if (!resolved.ok) {
        return resolved;
      }
      normalized.push(resolved.value.reference);
    }
    return ok(normalized);
  };

  const summarize = async (
    preset: PresetDto,
  ): Promise<Result<PresetSummary, PresetServiceError>> => {
    const missingPaths: string[] = [];
    for (const reference of preset.items) {
      const resolved = await resolveReference(reference, true);
      if (!resolved.ok) {
        return resolved;
      }
      if (!resolved.value.present) {
        missingPaths.push(resolved.value.reference.relativePath);
      }
    }
    return ok({ ...preset, missingPaths });
  };

  const findPreset = (state: PresetState, id: string): Result<PresetDto, PresetServiceError> => {
    const preset = state.presets.find((candidate) => candidate.id === id);
    return preset === undefined ? err({ code: "PRESET_NOT_FOUND", id }) : ok(preset);
  };

  const hasNameConflict = (state: PresetState, name: string, excludedId?: string): boolean => {
    const normalized = name.trim().toLocaleLowerCase();
    return state.presets.some(
      (preset) => preset.id !== excludedId && preset.name.trim().toLocaleLowerCase() === normalized,
    );
  };

  return {
    async list() {
      const state = await readState();
      if (!state.ok) return state;
      const summaries: PresetSummary[] = [];
      for (const preset of state.value.presets) {
        const summary = await summarize(preset);
        if (!summary.ok) return summary;
        summaries.push(summary.value);
      }
      return ok(summaries);
    },

    async create(request) {
      const state = await readState();
      if (!state.ok) return state;
      const name = request.name.trim();
      if (hasNameConflict(state.value, name)) {
        return err({ code: "PRESET_NAME_CONFLICT", name });
      }
      const items = await validateReferences(request.items);
      if (!items.ok) return items;
      const timestamp = now().toISOString();
      const preset: PresetDto = {
        id: createId(),
        name,
        items: items.value,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const written = await writeState({
        formatVersion: 1,
        presets: [...state.value.presets, preset],
      });
      if (!written.ok) return written;
      return ok({ ...preset, missingPaths: [] });
    },

    async rename(request) {
      const state = await readState();
      if (!state.ok) return state;
      const preset = findPreset(state.value, request.id);
      if (!preset.ok) return preset;
      const name = request.name.trim();
      if (hasNameConflict(state.value, name, request.id)) {
        return err({ code: "PRESET_NAME_CONFLICT", name });
      }
      const updated: PresetDto = {
        ...preset.value,
        name,
        updatedAt: now().toISOString(),
      };
      const written = await writeState({
        formatVersion: 1,
        presets: state.value.presets.map((candidate) =>
          candidate.id === request.id ? updated : candidate,
        ),
      });
      if (!written.ok) return written;
      return summarize(updated);
    },

    async remove(request) {
      const state = await readState();
      if (!state.ok) return state;
      const preset = findPreset(state.value, request.id);
      if (!preset.ok) return preset;
      const written = await writeState({
        formatVersion: 1,
        presets: state.value.presets.filter((candidate) => candidate.id !== request.id),
      });
      return written.ok ? ok({ id: preset.value.id }) : written;
    },

    async addItems(request) {
      const state = await readState();
      if (!state.ok) return state;
      const preset = findPreset(state.value, request.id);
      if (!preset.ok) return preset;
      const items = await validateReferences([...preset.value.items, ...request.items]);
      if (!items.ok) return items;
      const updated: PresetDto = {
        ...preset.value,
        items: items.value,
        updatedAt: now().toISOString(),
      };
      const written = await writeState({
        formatVersion: 1,
        presets: state.value.presets.map((candidate) =>
          candidate.id === request.id ? updated : candidate,
        ),
      });
      if (!written.ok) return written;
      return summarize(updated);
    },

    async install(id) {
      const state = await readState();
      if (!state.ok) return state;
      const preset = findPreset(state.value, id);
      if (!preset.ok) return preset;
      const existingItems: { kind: "patch"; relativePath: string }[] = [];
      const missingPaths: string[] = [];
      for (const reference of preset.value.items) {
        const resolved = await resolveReference(reference, true);
        if (!resolved.ok) return resolved;
        if (resolved.value.present) {
          existingItems.push(resolved.value.reference);
        } else {
          missingPaths.push(resolved.value.reference.relativePath);
        }
      }
      const installService = options.getInstallService
        ? options.getInstallService()
        : options.install === undefined
          ? err({ code: "GAME_DIRECTORY_REQUIRED" })
          : ok(options.install);
      if (!installService.ok) return installService;
      if (existingItems.length === 0) {
        return ok({ installedCount: 0, missingPaths });
      }
      const installed = await installService.value.enableMany(existingItems);
      return installed.ok
        ? ok({ installedCount: installed.value.installedCount, missingPaths })
        : installed;
    },
  };
}
