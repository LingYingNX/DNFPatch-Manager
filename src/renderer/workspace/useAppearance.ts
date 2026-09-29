import { useCallback, useEffect, useState } from "react";
import { defaultAppearanceSettings } from "../../core/state/schemas";
import type {
  AppearanceBundleDto,
  AppearanceSettingsDto,
  WallpaperSlot,
} from "../../shared/appearance-contracts";
import type { DnfApi } from "../../shared/ipc-contracts";
import type { Notice } from "./model";

const EMPTY_WALLPAPER: AppearanceBundleDto["wallpaper"] = {
  slots: [null, null, null, null, null],
  activeSlot: null,
};
const MINIMUM_WALLPAPER_CONTRAST_PERCENT = 50;
const WALLPAPER_PAN_MARGIN_PERCENT = 24;

function wallpaperPanOffset(position: number): string {
  const offset =
    ((50 - position) * WALLPAPER_PAN_MARGIN_PERCENT) / (50 + WALLPAPER_PAN_MARGIN_PERCENT);
  return `${offset}%`;
}

export function useAppearance(
  client: DnfApi | undefined,
  showNotice: (notice: Notice | null) => void,
) {
  const [appearance, setAppearance] = useState<AppearanceSettingsDto>(defaultAppearanceSettings());
  const [wallpaper, setWallpaper] = useState(EMPTY_WALLPAPER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const activeName = wallpaper.activeSlot === null ? null : wallpaper.slots[wallpaper.activeSlot];
    const temperatureMagnitude = Math.abs(appearance.temperature) / 100;
    const temperatureHue =
      appearance.temperature > 0 ? -temperatureMagnitude * 18 : temperatureMagnitude * 18;
    const navigationFontColor =
      appearance.theme === "high-contrast" ? "#FFFFFFFF" : appearance.navigationFontColor;
    const patchCardFontColor =
      appearance.theme === "high-contrast" ? "#FFFFFFFF" : appearance.patchCardFontColor;
    root.dataset["theme"] = appearance.theme;
    root.style.setProperty("--appearance-temperature", `${appearance.temperature}`);
    root.style.setProperty("--appearance-saturation", `${appearance.saturation}%`);
    root.style.setProperty(
      "--appearance-contrast",
      `${Math.max(MINIMUM_WALLPAPER_CONTRAST_PERCENT, appearance.contrast)}%`,
    );
    root.style.setProperty("--wallpaper-scale", `${appearance.scale / 100}`);
    root.style.setProperty("--wallpaper-opacity", `${appearance.opacity / 100}`);
    root.style.setProperty("--wallpaper-blur", `${appearance.blur}px`);
    root.style.setProperty("--wallpaper-position-x", `${appearance.positionX}%`);
    root.style.setProperty("--wallpaper-position-y", `${appearance.positionY}%`);
    root.style.setProperty("--wallpaper-offset-x", wallpaperPanOffset(appearance.positionX));
    root.style.setProperty("--wallpaper-offset-y", wallpaperPanOffset(appearance.positionY));
    root.style.setProperty(
      "--wallpaper-temperature-filter",
      `sepia(${temperatureMagnitude * 0.35}) hue-rotate(${temperatureHue}deg)`,
    );
    root.style.setProperty("--category-text-color", appearance.categoryTextColor);
    root.style.setProperty("--selected-tint", appearance.selectedTint);
    root.style.setProperty("--navigation-font-color", navigationFontColor);
    root.style.setProperty("--patch-card-font-color", patchCardFontColor);
    root.style.setProperty(
      "--wallpaper-image",
      activeName === null ? "none" : `url("dnf-asset://wallpaper/${activeName}")`,
    );
  }, [appearance, wallpaper]);

  const applyBundle = useCallback((bundle: AppearanceBundleDto) => {
    setAppearance(bundle.appearance);
    setWallpaper(bundle.wallpaper);
  }, []);

  useEffect(() => {
    if (client === undefined) return;
    void client.getAppearance().then((result) => {
      if (result.ok) applyBundle(result.value);
      else showNotice({ tone: "error", message: result.error.message });
    });
  }, [applyBundle, client, showNotice]);

  const update = async (next: AppearanceSettingsDto): Promise<void> => {
    if (client === undefined) return;
    const previous = appearance;
    setAppearance(next);
    const result = await client.updateAppearance(next);
    if (!result.ok) {
      setAppearance(previous);
      showNotice({ tone: "error", message: result.error.message });
    }
  };

  const runWallpaper = async (
    action: (slot: WallpaperSlot) => ReturnType<DnfApi["activateWallpaper"]>,
    slot: WallpaperSlot,
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await action(slot);
      if (result.ok) applyBundle(result.value);
      else showNotice({ tone: "error", message: result.error.message });
    } finally {
      setBusy(false);
    }
  };

  return {
    appearance,
    busy,
    wallpaper,
    update,
    importWallpaper: (slot: WallpaperSlot) =>
      client === undefined
        ? Promise.resolve()
        : runWallpaper((value) => client.importWallpaper({ slot: value }), slot),
    activateWallpaper: (slot: WallpaperSlot) =>
      client === undefined
        ? Promise.resolve()
        : runWallpaper((value) => client.activateWallpaper({ slot: value }), slot),
    deleteWallpaper: (slot: WallpaperSlot) =>
      client === undefined
        ? Promise.resolve()
        : runWallpaper((value) => client.deleteWallpaper({ slot: value }), slot),
  };
}
