import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { win32 } from "node:path";
import type { DataRoot, LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { err, ok, type Result } from "../../shared/result";
import { createAsyncMutex } from "../concurrency/async-mutex";
import type { FileTransactionStep } from "../filesystem/file-transaction";
import { LibraryItemNameSchema } from "../library/library-item-name";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";
import { normalizedPathKey, parentRelativePath } from "../paths/relative-path";
import type { StateStoreError } from "../state/atomic-json-store";
import {
  createVirtualGroupsStore,
  normalizeVirtualGroupRelativePath,
  type VirtualGroup,
  type VirtualGroupsState,
  virtualGroupMemberPathKey,
} from "./group-state";

const mutationMutexesByStateFile = new Map<string, ReturnType<typeof createAsyncMutex>>();

function mutationMutexForStateFile(file: string): ReturnType<typeof createAsyncMutex> {
  const key = normalizedPathKey(file);
  const existing = mutationMutexesByStateFile.get(key);
  if (existing !== undefined) return existing;
  const mutex = createAsyncMutex();
  mutationMutexesByStateFile.set(key, mutex);
  return mutex;
}

export type CreateVirtualGroupRequest = {
  readonly categoryRelativePath: string;
  readonly createdAt?: string;
  readonly id?: string;
  readonly memberRelativePaths: readonly string[];
  readonly name: string;
};

export type VirtualGroupServiceError =
  | LibraryPathError
  | StateStoreError
  | { readonly code: "INVALID_GROUP_NAME" }
  | { readonly code: "INVALID_GROUP_MEMBERS" }
  | { readonly code: "INVALID_GROUP_MEMBER"; readonly relativePath: string }
  | { readonly code: "DUPLICATE_GROUP_MEMBER"; readonly relativePath: string }
  | { readonly code: "GROUP_MEMBER_OUTSIDE_CATEGORY"; readonly relativePath: string }
  | { readonly code: "GROUP_MEMBER_NOT_FOUND"; readonly relativePath: string }
  | { readonly code: "GROUP_MEMBER_TYPE_MISMATCH"; readonly relativePath: string }
  | { readonly code: "GROUP_MEMBER_ASSIGNED"; readonly relativePath: string }
  | { readonly code: "DUPLICATE_GROUP_ID"; readonly id: string }
  | { readonly code: "GROUP_NOT_FOUND"; readonly id: string }
  | { readonly code: "INVALID_GROUP_CATEGORY" }
  | { readonly code: "LIBRARY_IO" };

export type GroupRelocation = {
  readonly groupId: string;
  readonly categoryRelativePath: string;
  readonly name?: string;
};

export type VirtualGroupStatePlan = {
  readonly steps: readonly FileTransactionStep[];
};

export type VirtualGroupDissolvePlan = VirtualGroupStatePlan & {
  readonly id: string;
};

export type VirtualGroupService = {
  readonly list: () => Promise<Result<VirtualGroupsState, StateStoreError>>;
  readonly get: (groupId: string) => Promise<Result<VirtualGroup, VirtualGroupServiceError>>;
  readonly findByMemberPath: (
    relativePath: string,
  ) => Promise<Result<VirtualGroup | null, StateStoreError>>;
  readonly create: (
    request: CreateVirtualGroupRequest,
  ) => Promise<Result<VirtualGroup, VirtualGroupServiceError>>;
  readonly addMembers: (
    groupId: string,
    memberRelativePaths: readonly string[],
  ) => Promise<Result<VirtualGroup, VirtualGroupServiceError>>;
  readonly dissolve: (
    groupId: string,
  ) => Promise<Result<{ readonly id: string }, VirtualGroupServiceError>>;
  readonly prepareDissolve: (
    groupId: string,
  ) => Promise<Result<VirtualGroupDissolvePlan, VirtualGroupServiceError>>;
  readonly prepareRemoveMembers: (
    memberRelativePaths: readonly string[],
  ) => Promise<Result<VirtualGroupStatePlan, VirtualGroupServiceError>>;
  readonly prepareRelocation: (
    relocation: GroupRelocation,
  ) => Promise<Result<VirtualGroupStatePlan, VirtualGroupServiceError>>;
  readonly prepareUpdates: (request: {
    readonly memberRelativePathsToRemove: readonly string[];
    readonly relocations: readonly GroupRelocation[];
  }) => Promise<Result<VirtualGroupStatePlan, VirtualGroupServiceError>>;
};

export type CreateVirtualGroupServiceOptions = {
  readonly dataRoot: DataRoot;
  readonly libraryRoot: LibraryRoot;
  readonly createId?: () => string;
  readonly now?: () => Date;
};

function normalizeCategoryRelativePath(relativePath: string): string {
  const normalized = normalizeVirtualGroupRelativePath(relativePath);
  return normalized === "." ? "" : normalized;
}

function isSameRelativePath(left: string, right: string): boolean {
  return virtualGroupMemberPathKey(left) === virtualGroupMemberPathKey(right);
}

function statesMatch(left: VirtualGroupsState, right: VirtualGroupsState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createVirtualGroupService(
  options: CreateVirtualGroupServiceOptions,
): VirtualGroupService {
  const stateFile = win32.join(options.dataRoot, "groups.json");
  const store = createVirtualGroupsStore(stateFile);
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const mutationMutex = mutationMutexForStateFile(stateFile);

  const list = (): Promise<Result<VirtualGroupsState, StateStoreError>> => store.read();

  const prepareStateWrite = (
    before: VirtualGroupsState,
    next: VirtualGroupsState,
  ): Result<VirtualGroupStatePlan, VirtualGroupServiceError> => {
    if (statesMatch(before, next)) return ok({ steps: [] });

    const write = async (value: VirtualGroupsState): Promise<void> => {
      const written = await store.write(value);
      if (!written.ok) throw new Error("Unable to write virtual group state");
    };
    return ok({
      steps: [
        {
          apply: () =>
            mutationMutex.runExclusive(async () => {
              const current = await list();
              if (!current.ok || !statesMatch(current.value, before)) {
                throw new Error("Virtual group state changed while a transaction was pending");
              }
              await write(next);
            }),
          compensate: () => mutationMutex.runExclusive(() => write(before)),
          label: "update virtual group state",
          paths: [stateFile],
        },
      ],
    });
  };

  const prepareUpdates = async (request: {
    readonly memberRelativePathsToRemove: readonly string[];
    readonly relocations: readonly GroupRelocation[];
  }): Promise<Result<VirtualGroupStatePlan, VirtualGroupServiceError>> => {
    return mutationMutex.runExclusive(async () => {
      const state = await list();
      if (!state.ok) return state;

      const removalKeys = new Set(
        request.memberRelativePathsToRemove.map(virtualGroupMemberPathKey),
      );
      const relocations = new Map<string, GroupRelocation>();
      for (const relocation of request.relocations) {
        const categoryRelativePath = normalizeCategoryRelativePath(relocation.categoryRelativePath);
        if (categoryRelativePath !== relocation.categoryRelativePath) {
          return err({ code: "INVALID_GROUP_CATEGORY" });
        }
        if (
          relocation.name !== undefined &&
          !LibraryItemNameSchema.safeParse(relocation.name).success
        ) {
          return err({ code: "INVALID_GROUP_NAME" });
        }
        relocations.set(relocation.groupId, relocation);
      }

      const groupIds = new Set(state.value.groups.map((group) => group.id));
      for (const groupId of relocations.keys()) {
        if (!groupIds.has(groupId)) return err({ code: "GROUP_NOT_FOUND", id: groupId });
      }

      const next: VirtualGroupsState = {
        formatVersion: 1,
        groups: state.value.groups.flatMap((group) => {
          const retainedMembers = group.memberRelativePaths.filter(
            (memberRelativePath) => !removalKeys.has(virtualGroupMemberPathKey(memberRelativePath)),
          );
          if (retainedMembers.length < 2) return [];

          const relocation = relocations.get(group.id);
          if (relocation === undefined) {
            return [{ ...group, memberRelativePaths: retainedMembers }];
          }
          const categoryRelativePath = normalizeCategoryRelativePath(
            relocation.categoryRelativePath,
          );
          return [
            {
              ...group,
              categoryRelativePath,
              memberRelativePaths: retainedMembers.map((memberRelativePath) =>
                win32.join(categoryRelativePath, win32.basename(memberRelativePath)),
              ),
              ...(relocation.name === undefined ? {} : { name: relocation.name }),
            },
          ];
        }),
      };
      return prepareStateWrite(state.value, next);
    });
  };

  const prepareDissolve = async (
    groupId: string,
  ): Promise<Result<VirtualGroupDissolvePlan, VirtualGroupServiceError>> => {
    return mutationMutex.runExclusive(async () => {
      const state = await list();
      if (!state.ok) return state;
      if (!state.value.groups.some((group) => group.id === groupId)) {
        return err({ code: "GROUP_NOT_FOUND", id: groupId });
      }
      const next: VirtualGroupsState = {
        formatVersion: 1,
        groups: state.value.groups.filter((group) => group.id !== groupId),
      };
      const plan = prepareStateWrite(state.value, next);
      return plan.ok ? ok({ id: groupId, steps: plan.value.steps }) : plan;
    });
  };

  return {
    list,
    async get(groupId) {
      const state = await list();
      if (!state.ok) return state;
      const group = state.value.groups.find((candidate) => candidate.id === groupId);
      return group === undefined ? err({ code: "GROUP_NOT_FOUND", id: groupId }) : ok(group);
    },
    async findByMemberPath(relativePath) {
      const state = await list();
      if (!state.ok) return state;
      const group = state.value.groups.find((candidate) =>
        candidate.memberRelativePaths.some((member) => isSameRelativePath(member, relativePath)),
      );
      return ok(group ?? null);
    },
    async create(request) {
      return mutationMutex.runExclusive(async () => {
        const parsedName = LibraryItemNameSchema.safeParse(request.name);
        if (!parsedName.success) return err({ code: "INVALID_GROUP_NAME" });
        if (request.memberRelativePaths.length < 2) return err({ code: "INVALID_GROUP_MEMBERS" });

        const categoryRelativePath = normalizeCategoryRelativePath(request.categoryRelativePath);
        const memberRelativePaths = request.memberRelativePaths.map(
          normalizeVirtualGroupRelativePath,
        );
        const members = new Set<string>();
        for (const memberRelativePath of memberRelativePaths) {
          const key = virtualGroupMemberPathKey(memberRelativePath);
          if (members.has(key)) {
            return err({ code: "DUPLICATE_GROUP_MEMBER", relativePath: memberRelativePath });
          }
          members.add(key);
          if (
            !isLibraryPatchPath(memberRelativePath) ||
            !isSameRelativePath(parentRelativePath(memberRelativePath), categoryRelativePath)
          ) {
            return err({
              code: isLibraryPatchPath(memberRelativePath)
                ? "GROUP_MEMBER_OUTSIDE_CATEGORY"
                : "INVALID_GROUP_MEMBER",
              relativePath: memberRelativePath,
            });
          }
        }

        for (const memberRelativePath of memberRelativePaths) {
          const resolved = resolveLibraryPath(options.libraryRoot, memberRelativePath);
          if (!resolved.ok) return resolved;
          try {
            const metadata = await lstat(resolved.value);
            if (!metadata.isFile()) {
              return err({ code: "GROUP_MEMBER_TYPE_MISMATCH", relativePath: memberRelativePath });
            }
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
              return err({ code: "GROUP_MEMBER_NOT_FOUND", relativePath: memberRelativePath });
            }
            if (error instanceof Error) return err({ code: "LIBRARY_IO" });
            throw error;
          }
        }

        const state = await list();
        if (!state.ok) return state;
        const id = request.id ?? createId();
        if (state.value.groups.some((candidate) => candidate.id === id)) {
          return err({ code: "DUPLICATE_GROUP_ID", id });
        }
        for (const memberRelativePath of memberRelativePaths) {
          if (
            state.value.groups.some((group) =>
              group.memberRelativePaths.some((member) =>
                isSameRelativePath(member, memberRelativePath),
              ),
            )
          ) {
            return err({ code: "GROUP_MEMBER_ASSIGNED", relativePath: memberRelativePath });
          }
        }

        const group: VirtualGroup = {
          id,
          name: parsedName.data,
          categoryRelativePath,
          memberRelativePaths,
          createdAt: request.createdAt ?? now().toISOString(),
        };
        const written = await store.write({
          formatVersion: 1,
          groups: [...state.value.groups, group],
        });
        return written.ok ? ok(group) : written;
      });
    },
    async addMembers(groupId, memberRelativePaths) {
      return mutationMutex.runExclusive(async () => {
        const state = await list();
        if (!state.ok) return state;
        const target = state.value.groups.find((group) => group.id === groupId);
        if (target === undefined) return err({ code: "GROUP_NOT_FOUND", id: groupId });
        if (memberRelativePaths.length === 0) return err({ code: "INVALID_GROUP_MEMBERS" });

        const normalizedMembers = memberRelativePaths.map(normalizeVirtualGroupRelativePath);
        const targetMembers = new Set(target.memberRelativePaths.map(virtualGroupMemberPathKey));
        const assignedMembers = new Set(
          state.value.groups
            .filter((group) => group.id !== groupId)
            .flatMap((group) => group.memberRelativePaths.map(virtualGroupMemberPathKey)),
        );
        const additions: string[] = [];
        for (const memberRelativePath of normalizedMembers) {
          const key = virtualGroupMemberPathKey(memberRelativePath);
          if (
            !isLibraryPatchPath(memberRelativePath) ||
            !isSameRelativePath(parentRelativePath(memberRelativePath), target.categoryRelativePath)
          ) {
            return err({
              code: isLibraryPatchPath(memberRelativePath)
                ? "GROUP_MEMBER_OUTSIDE_CATEGORY"
                : "INVALID_GROUP_MEMBER",
              relativePath: memberRelativePath,
            });
          }
          if (targetMembers.has(key)) {
            return err({ code: "DUPLICATE_GROUP_MEMBER", relativePath: memberRelativePath });
          }
          if (assignedMembers.has(key)) {
            return err({ code: "GROUP_MEMBER_ASSIGNED", relativePath: memberRelativePath });
          }
          const resolved = resolveLibraryPath(options.libraryRoot, memberRelativePath);
          if (!resolved.ok) return resolved;
          try {
            const metadata = await lstat(resolved.value);
            if (!metadata.isFile()) {
              return err({ code: "GROUP_MEMBER_TYPE_MISMATCH", relativePath: memberRelativePath });
            }
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
              return err({ code: "GROUP_MEMBER_NOT_FOUND", relativePath: memberRelativePath });
            }
            if (error instanceof Error) return err({ code: "LIBRARY_IO" });
            throw error;
          }
          targetMembers.add(key);
          additions.push(memberRelativePath);
        }

        const next: VirtualGroupsState = {
          formatVersion: 1,
          groups: state.value.groups.map((group) =>
            group.id === groupId
              ? { ...group, memberRelativePaths: [...group.memberRelativePaths, ...additions] }
              : group,
          ),
        };
        const written = await store.write(next);
        return written.ok
          ? ok(next.groups.find((group) => group.id === groupId) as VirtualGroup)
          : written;
      });
    },
    async dissolve(groupId) {
      return mutationMutex.runExclusive(async () => {
        const state = await list();
        if (!state.ok) return state;
        const exists = state.value.groups.some((group) => group.id === groupId);
        if (!exists) return err({ code: "GROUP_NOT_FOUND", id: groupId });
        const written = await store.write({
          formatVersion: 1,
          groups: state.value.groups.filter((group) => group.id !== groupId),
        });
        return written.ok ? ok({ id: groupId }) : written;
      });
    },
    prepareDissolve,
    prepareRemoveMembers(memberRelativePaths) {
      return prepareUpdates({ memberRelativePathsToRemove: memberRelativePaths, relocations: [] });
    },
    prepareRelocation(relocation) {
      return prepareUpdates({ memberRelativePathsToRemove: [], relocations: [relocation] });
    },
    prepareUpdates,
  };
}
