import { z } from "zod";
import { isCategoryOrderForParent } from "../../shared/category-order";
import {
  CategoryFolderColorsSchema,
  CategoryFolderStyleColorsSchema,
  CategoryFolderStylesSchema,
} from "../../shared/category-styles";

export const RecycleEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.union([z.literal("patch"), z.literal("group")]),
  originalRelativePath: z.string().min(1),
  recycledRelativePath: z.string().min(1),
  recycledAt: z.string().datetime(),
});

export const RecycleManifestSchema = z.object({
  formatVersion: z.literal(1),
  items: z.array(RecycleEntrySchema),
});

export type RecycleEntry = z.infer<typeof RecycleEntrySchema>;
export type RecycleManifest = z.infer<typeof RecycleManifestSchema>;

export function emptyRecycleManifest(): RecycleManifest {
  return { formatVersion: 1, items: [] };
}

export const InstallationRecordSchema = z.object({
  sourceRelativePath: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  targetPath: z.string().min(1),
  targetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  enabledAt: z.string().datetime(),
  transactionId: z.string().uuid(),
});

export const InstallationStateSchema = z.object({
  formatVersion: z.literal(1),
  records: z.array(InstallationRecordSchema),
});

export type InstallationRecord = z.infer<typeof InstallationRecordSchema>;
export type InstallationState = z.infer<typeof InstallationStateSchema>;

export function emptyInstallationState(): InstallationState {
  return { formatVersion: 1, records: [] };
}

const HexColorSchema = z.string().regex(/^#[A-Fa-f0-9]{6}(?:[A-Fa-f0-9]{2})?$/u);

const AppearanceSettingsValueSchema = z.object({
  theme: z.union([z.literal("halo"), z.literal("glass"), z.literal("high-contrast")]),
  temperature: z.number().min(-100).max(100),
  saturation: z.number().min(0).max(200),
  contrast: z.number().min(0).max(200),
  scale: z.number().min(50).max(200),
  opacity: z.number().min(0).max(100),
  blur: z.number().min(0).max(40),
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
  categoryTextColor: HexColorSchema,
  selectedTint: HexColorSchema,
  navigationFontColor: HexColorSchema.default("#F2F4F8FF"),
  patchCardFontColor: HexColorSchema.default("#F2F4F8FF"),
});

export const AppearanceSettingsSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const legacy = value as Record<string, unknown>;
  return {
    ...legacy,
    navigationFontColor: legacy["navigationFontColor"] ?? legacy["fontColor"],
    patchCardFontColor: legacy["patchCardFontColor"] ?? legacy["fontColor"],
  };
}, AppearanceSettingsValueSchema);

export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>;

type WallpaperControlSettings = Pick<
  AppearanceSettings,
  | "temperature"
  | "saturation"
  | "contrast"
  | "scale"
  | "opacity"
  | "blur"
  | "positionX"
  | "positionY"
>;

export function defaultWallpaperControls(): WallpaperControlSettings {
  return {
    temperature: 0,
    saturation: 100,
    contrast: 100,
    scale: 100,
    opacity: 50,
    blur: 0,
    positionX: 50,
    positionY: 50,
  };
}

export function resetWallpaperControls(appearance: AppearanceSettings): AppearanceSettings {
  return { ...appearance, ...defaultWallpaperControls() };
}

export function defaultAppearanceSettings(): AppearanceSettings {
  return {
    theme: "halo",
    ...defaultWallpaperControls(),
    categoryTextColor: "#9AA0AE",
    selectedTint: "#5B6BFF",
    navigationFontColor: "#F2F4F8FF",
    patchCardFontColor: "#F2F4F8FF",
  };
}

export const AppSettingsSchema = z.object({
  formatVersion: z.literal(1),
  gameDirectory: z.string().min(1).nullable(),
  appearance: AppearanceSettingsSchema.default(defaultAppearanceSettings()),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export function defaultAppSettings(): AppSettings {
  return { formatVersion: 1, gameDirectory: null, appearance: defaultAppearanceSettings() };
}

const ActivePatchPreviewBindingSchema = z.object({
  state: z.literal("active"),
  kind: z.literal("patch"),
  relativePath: z.string().min(1),
  assetName: z.string().min(1),
});

const ActiveGroupPreviewBindingSchema = z.object({
  state: z.literal("active"),
  kind: z.literal("group"),
  groupId: z.string().uuid(),
  assetName: z.string().min(1),
});

const LegacyActiveGroupPreviewBindingSchema = z.object({
  state: z.literal("active"),
  kind: z.literal("group"),
  relativePath: z.string().min(1),
  assetName: z.string().min(1),
});

export const PreviewBindingSchema = z.union([
  ActivePatchPreviewBindingSchema,
  ActiveGroupPreviewBindingSchema,
  LegacyActiveGroupPreviewBindingSchema,
  z.object({
    state: z.literal("recycled"),
    recycleEntryId: z.string().uuid(),
    assetName: z.string().min(1),
  }),
]);

export const PreviewStateSchema = z
  .object({
    formatVersion: z.literal(1),
    bindings: z.array(PreviewBindingSchema),
  })
  .refine((state) => {
    const identities = new Set<string>();
    for (const binding of state.bindings) {
      const identity =
        binding.state === "active"
          ? binding.kind === "patch"
            ? `active:patch:${binding.relativePath.toLocaleLowerCase()}`
            : "groupId" in binding
              ? `active:group:${binding.groupId.toLocaleLowerCase()}`
              : `active:group-path:${binding.relativePath
                  .replaceAll("/", "\\")
                  .toLocaleLowerCase()}`
          : `recycled:${binding.recycleEntryId}`;
      if (identities.has(identity)) return false;
      identities.add(identity);
    }
    return true;
  });

export type PreviewState = z.infer<typeof PreviewStateSchema>;

export function emptyPreviewState(): PreviewState {
  return { formatVersion: 1, bindings: [] };
}

const WallpaperSlotSchema = z.string().min(1).nullable();
const WallpaperSlotIndexSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const WallpaperStateSchema = z
  .object({
    formatVersion: z.literal(1),
    slots: z.tuple([
      WallpaperSlotSchema,
      WallpaperSlotSchema,
      WallpaperSlotSchema,
      WallpaperSlotSchema,
      WallpaperSlotSchema,
    ]),
    activeSlot: WallpaperSlotIndexSchema.nullable(),
  })
  .refine((state) => state.activeSlot === null || state.slots[state.activeSlot] !== null);

export type WallpaperState = z.infer<typeof WallpaperStateSchema>;

export function emptyWallpaperState(): WallpaperState {
  return { formatVersion: 1, slots: [null, null, null, null, null], activeSlot: null };
}

export const CategoryOrderStateSchema = z.object({
  formatVersion: z.literal(1),
  orders: z
    .record(z.string(), z.array(z.string()))
    .refine((orders) =>
      Object.entries(orders).every(([parent, children]) =>
        isCategoryOrderForParent(parent, children),
      ),
    ),
});

export type CategoryOrderState = z.infer<typeof CategoryOrderStateSchema>;

export const CategoryStyleStateSchema = z.object({
  formatVersion: z.literal(1),
  styles: CategoryFolderStylesSchema,
  colors: CategoryFolderColorsSchema.default({}),
  styleColors: CategoryFolderStyleColorsSchema.default({}),
});

export type CategoryStyleState = z.infer<typeof CategoryStyleStateSchema>;
