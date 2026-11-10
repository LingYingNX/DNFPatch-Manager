import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVirtualGroupService } from "../../src/core/groups/group-service";
import { resolveAppPaths } from "../../src/main/app-paths";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createFixture(): Promise<{
  readonly categoryA: string;
  readonly paths: ReturnType<typeof resolveAppPaths>;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-virtual-groups-"));
  temporaryDirectories.push(projectRoot);
  const paths = resolveAppPaths({ mode: "development", projectRoot });
  const categoryA = join(paths.libraryRoot, "CategoryA");
  await Promise.all([
    mkdir(categoryA, { recursive: true }),
    mkdir(join(paths.libraryRoot, "CategoryB"), { recursive: true }),
  ]);
  await Promise.all([
    mkdir(join(categoryA, "folder.npk")),
    writeFile(join(categoryA, "a.npk"), "a"),
    writeFile(join(categoryA, "b.npk"), "b"),
    writeFile(join(categoryA, "c.npk"), "c"),
    writeFile(join(categoryA, "d.npk"), "d"),
    writeFile(join(paths.libraryRoot, "CategoryB", "d.npk"), "d"),
  ]);
  return { categoryA, paths };
}

describe("virtual group service", () => {
  it("persists a same-category group without moving its NPK files", async () => {
    const { categoryA, paths } = await createFixture();
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => "0552babf-49b5-4390-96a7-1846a0c1e9f8",
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });
    await expect(groups.list()).resolves.toEqual({
      ok: true,
      value: { formatVersion: 1, groups: [] },
    });

    const result = await groups.create({
      categoryRelativePath: "CategoryA",
      memberRelativePaths: ["CategoryA/a.npk", "CategoryA\\b.npk"],
      name: "Bundle",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
        name: "Bundle",
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        createdAt: "2026-08-06T00:00:00.000Z",
      },
    });
    await expect(readFile(join(categoryA, "a.npk"), "utf8")).resolves.toBe("a");
    await expect(readFile(join(categoryA, "b.npk"), "utf8")).resolves.toBe("b");
    await expect(access(join(paths.libraryRoot, "CategoryA", "Bundle"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(JSON.parse(await readFile(join(paths.dataRoot, "groups.json"), "utf8"))).toMatchObject({
      formatVersion: 1,
      groups: [
        {
          id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
          memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        },
      ],
    });
  });

  it("adds same-category members without moving NPK files and persists the update", async () => {
    const { categoryA, paths } = await createFixture();
    const groupId = "0552babf-49b5-4390-96a7-1846a0c1e9f8";
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => groupId,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });
    const created = await groups.create({
      categoryRelativePath: "CategoryA",
      memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
      name: "Bundle",
    });
    if (!created.ok) throw new Error("Expected group creation to succeed");

    await expect(groups.addMembers(groupId, ["CategoryA/c.npk"])).resolves.toEqual({
      ok: true,
      value: {
        ...created.value,
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk", "CategoryA\\c.npk"],
      },
    });
    await expect(readFile(join(categoryA, "c.npk"), "utf8")).resolves.toBe("c");
    await expect(groups.addMembers(groupId, ["categorya/a.npk"])).resolves.toEqual({
      ok: false,
      error: { code: "DUPLICATE_GROUP_MEMBER", relativePath: "categorya\\a.npk" },
    });

    const reopened = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
    });
    await expect(reopened.get(groupId)).resolves.toMatchObject({
      ok: true,
      value: {
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk", "CategoryA\\c.npk"],
      },
    });
  });

  it("rejects duplicate, cross-category, and assigned group members", async () => {
    const { paths } = await createFixture();
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => crypto.randomUUID(),
    });

    await expect(
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "categorya/a.npk"],
        name: "Duplicate",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "DUPLICATE_GROUP_MEMBER", relativePath: "categorya\\a.npk" },
    });
    await expect(
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryB\\d.npk"],
        name: "Cross category",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "GROUP_MEMBER_OUTSIDE_CATEGORY", relativePath: "CategoryB\\d.npk" },
    });
    const first = await groups.create({
      categoryRelativePath: "CategoryA",
      memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
      name: "First",
    });
    if (!first.ok) throw new Error("Expected group creation to succeed");

    await expect(
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["categorya/a.npk", "CategoryA\\c.npk"],
        name: "Second",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "GROUP_MEMBER_ASSIGNED", relativePath: "categorya\\a.npk" },
    });
  });

  it("removes members without deleting files and dissolves a group below two members", async () => {
    const { categoryA, paths } = await createFixture();
    const groupId = "0552babf-49b5-4390-96a7-1846a0c1e9f8";
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => groupId,
    });
    const created = await groups.create({
      categoryRelativePath: "CategoryA",
      memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk", "CategoryA\\c.npk"],
      name: "Bundle",
    });
    if (!created.ok) throw new Error("Expected group creation to succeed");

    await expect(groups.removeMembers(groupId, ["CategoryA\\a.npk"])).resolves.toEqual({
      ok: true,
      value: { dissolved: false, id: groupId },
    });
    await expect(groups.get(groupId)).resolves.toMatchObject({
      ok: true,
      value: { memberRelativePaths: ["CategoryA\\b.npk", "CategoryA\\c.npk"] },
    });

    await expect(groups.removeMembers(groupId, ["CategoryA/b.npk"])).resolves.toEqual({
      ok: true,
      value: { dissolved: true, id: groupId },
    });
    await expect(groups.get(groupId)).resolves.toEqual({
      ok: false,
      error: { code: "GROUP_NOT_FOUND", id: groupId },
    });
    await expect(readFile(join(categoryA, "a.npk"), "utf8")).resolves.toBe("a");
    await expect(readFile(join(categoryA, "b.npk"), "utf8")).resolves.toBe("b");
    await expect(readFile(join(categoryA, "c.npk"), "utf8")).resolves.toBe("c");
  });

  it("rejects non-NPK, missing, directory, and escaping members with typed errors", async () => {
    const { paths } = await createFixture();
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => crypto.randomUUID(),
    });

    await expect(
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.txt", "CategoryA\\b.npk"],
        name: "Invalid extension",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_GROUP_MEMBER", relativePath: "CategoryA\\a.txt" },
    });
    await expect(
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\missing.npk", "CategoryA\\b.npk"],
        name: "Missing",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "GROUP_MEMBER_NOT_FOUND", relativePath: "CategoryA\\missing.npk" },
    });
    await expect(
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\folder.npk", "CategoryA\\b.npk"],
        name: "Directory",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "GROUP_MEMBER_TYPE_MISMATCH", relativePath: "CategoryA\\folder.npk" },
    });
    await expect(
      groups.create({
        categoryRelativePath: "..",
        memberRelativePaths: ["..\\outside.npk", "..\\second.npk"],
        name: "Outside library",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "PATH_OUTSIDE_LIBRARY", relativePath: "..\\outside.npk" },
    });
  });

  it("serializes concurrent creates with distinct members", async () => {
    const { paths } = await createFixture();
    const ids = ["0552babf-49b5-4390-96a7-1846a0c1e9f8", "d6af2f5d-b60e-447f-ae18-4548c5929aea"];
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => ids.shift() ?? crypto.randomUUID(),
    });

    const results = await Promise.all([
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        name: "First",
      }),
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\c.npk", "CategoryA\\d.npk"],
        name: "Second",
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    await expect(groups.list()).resolves.toMatchObject({
      ok: true,
      value: { groups: [{ name: "First" }, { name: "Second" }] },
    });
  });

  it("serializes concurrent creates that share a member", async () => {
    const { paths } = await createFixture();
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => crypto.randomUUID(),
    });

    const results = await Promise.all([
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        name: "First",
      }),
      groups.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\c.npk"],
        name: "Second",
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({
      ok: false,
      error: { code: "GROUP_MEMBER_ASSIGNED", relativePath: "CategoryA\\a.npk" },
    });
  });

  it("serializes concurrent creates across service instances with distinct members", async () => {
    const { paths } = await createFixture();
    const first = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => "0552babf-49b5-4390-96a7-1846a0c1e9f8",
    });
    const second = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => "d6af2f5d-b60e-447f-ae18-4548c5929aea",
    });

    const results = await Promise.all([
      first.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        name: "First",
      }),
      second.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\c.npk", "CategoryA\\d.npk"],
        name: "Second",
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    await expect(first.list()).resolves.toMatchObject({
      ok: true,
      value: { groups: [{ name: "First" }, { name: "Second" }] },
    });
  });

  it("serializes concurrent shared members across service instances", async () => {
    const { paths } = await createFixture();
    const first = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => crypto.randomUUID(),
    });
    const second = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => crypto.randomUUID(),
    });

    const results = await Promise.all([
      first.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        name: "First",
      }),
      second.create({
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\c.npk"],
        name: "Second",
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({
      ok: false,
      error: { code: "GROUP_MEMBER_ASSIGNED", relativePath: "CategoryA\\a.npk" },
    });
  });

  it("dissolves state without removing member NPK files", async () => {
    const { categoryA, paths } = await createFixture();
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => "0552babf-49b5-4390-96a7-1846a0c1e9f8",
    });
    const created = await groups.create({
      categoryRelativePath: "CategoryA",
      memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
      name: "Bundle",
    });
    if (!created.ok) throw new Error("Expected group creation to succeed");

    await expect(groups.dissolve(created.value.id)).resolves.toEqual({
      ok: true,
      value: { id: created.value.id },
    });
    await expect(groups.list()).resolves.toEqual({
      ok: true,
      value: { formatVersion: 1, groups: [] },
    });
    await expect(access(join(categoryA, "a.npk"))).resolves.toBeUndefined();
    await expect(access(join(categoryA, "b.npk"))).resolves.toBeUndefined();
  });

  it("reads persisted state after the service is recreated", async () => {
    const { paths } = await createFixture();
    const groupId = "0552babf-49b5-4390-96a7-1846a0c1e9f8";
    const created = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => groupId,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });
    await created.create({
      categoryRelativePath: "CategoryA",
      memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
      name: "Bundle",
    });

    const reopened = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
    });

    await expect(reopened.get(groupId)).resolves.toEqual({
      ok: true,
      value: {
        id: groupId,
        name: "Bundle",
        categoryRelativePath: "CategoryA",
        memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
        createdAt: "2026-08-06T00:00:00.000Z",
      },
    });
    await expect(reopened.findByMemberPath("categorya/a.npk")).resolves.toMatchObject({
      ok: true,
      value: { id: groupId },
    });
  });

  it.each([
    {
      categoryRelativePath: "CategoryA",
      memberRelativePath: "CategoryA\\a.txt",
      name: "non-NPK member",
    },
    {
      categoryRelativePath: "CategoryA",
      memberRelativePath: "CategoryB\\a.npk",
      name: "member outside its category",
    },
    {
      categoryRelativePath: "CategoryA",
      memberRelativePath: "CategoryA\\\\a.npk",
      name: "noncanonical member path",
    },
    {
      categoryRelativePath: "..",
      memberRelativePath: "..\\a.npk",
      name: "escaping member path",
    },
    {
      categoryRelativePath: "C:CategoryA",
      memberRelativePath: "C:CategoryA\\member.npk",
      secondMemberRelativePath: "C:CategoryA\\second.npk",
      name: "drive-relative category and member paths",
    },
  ])(
    "rejects a persisted $name",
    async ({ categoryRelativePath, memberRelativePath, secondMemberRelativePath }) => {
      const { paths } = await createFixture();
      const stateFile = join(paths.dataRoot, "groups.json");
      await mkdir(paths.dataRoot, { recursive: true });
      await writeFile(
        stateFile,
        JSON.stringify({
          formatVersion: 1,
          groups: [
            {
              id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
              name: "First",
              categoryRelativePath,
              memberRelativePaths: [
                secondMemberRelativePath ?? memberRelativePath,
                memberRelativePath,
              ],
              createdAt: "2026-08-06T00:00:00.000Z",
            },
          ],
        }),
        "utf8",
      );

      await expect(
        createVirtualGroupService({
          dataRoot: paths.dataRoot,
          libraryRoot: paths.libraryRoot,
        }).list(),
      ).resolves.toEqual({ ok: false, error: { code: "STATE_CORRUPTED", file: stateFile } });
    },
  );

  it("rejects persisted duplicates with extra path separators", async () => {
    const { paths } = await createFixture();
    const stateFile = join(paths.dataRoot, "groups.json");
    await mkdir(paths.dataRoot, { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({
        formatVersion: 1,
        groups: [
          {
            id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
            name: "First",
            categoryRelativePath: "CategoryA",
            memberRelativePaths: ["CategoryA\\a.npk", "CategoryA\\b.npk"],
            createdAt: "2026-08-06T00:00:00.000Z",
          },
          {
            id: "d6af2f5d-b60e-447f-ae18-4548c5929aea",
            name: "Second",
            categoryRelativePath: "categorya",
            memberRelativePaths: ["categorya\\A.npk", "categorya\\c.npk"],
            createdAt: "2026-08-06T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await expect(
      createVirtualGroupService({
        dataRoot: paths.dataRoot,
        libraryRoot: paths.libraryRoot,
      }).list(),
    ).resolves.toEqual({ ok: false, error: { code: "STATE_CORRUPTED", file: stateFile } });
  });
});
