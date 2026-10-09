import { z } from "zod";

export const PatchItemSchema = z.object({
  kind: z.literal("patch"),
  name: z.string(),
  relativePath: z.string(),
  previewRelativePath: z.string().nullable(),
  previewUrl: z.string().nullable(),
  // Optional so snapshots produced before BK2 support stay readable.
  videoPreviewUrl: z.string().nullable().optional(),
  size: z.number().nonnegative(),
  modifiedAt: z.string().datetime(),
  enabled: z.boolean(),
});

export const GroupItemSchema = z.object({
  kind: z.literal("group"),
  id: z.string().uuid(),
  name: z.string(),
  // Kept optional while legacy marker directories are still readable during migration.
  categoryRelativePath: z.string().optional(),
  relativePath: z.string(),
  previewRelativePath: z.string().nullable().default(null),
  previewUrl: z.string().nullable(),
  patchCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  enabled: z.boolean(),
});

export type ChildCategory = {
  readonly name: string;
  readonly relativePath: string;
  readonly patchCount: number;
  readonly childCategories: readonly ChildCategory[];
};

export const ChildCategorySchema: z.ZodType<ChildCategory> = z.lazy(() =>
  z.object({
    name: z.string(),
    relativePath: z.string(),
    patchCount: z.number().int().nonnegative(),
    childCategories: z.array(ChildCategorySchema),
  }),
);

export const CategorySnapshotSchema = z.object({
  relativePath: z.string(),
  patchCount: z.number().int().nonnegative(),
  patches: z.array(PatchItemSchema),
  groups: z.array(GroupItemSchema),
  childCategories: z.array(ChildCategorySchema),
});

export type PatchItem = z.infer<typeof PatchItemSchema>;
export type GroupItem = z.infer<typeof GroupItemSchema>;
export type CategorySnapshot = z.infer<typeof CategorySnapshotSchema>;

export const GroupSnapshotSchema = z.object({
  group: GroupItemSchema,
  patches: z.array(PatchItemSchema),
});

export type GroupSnapshot = z.infer<typeof GroupSnapshotSchema>;
