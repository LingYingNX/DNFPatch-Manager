import { Image as ImageIcon, Plus, RotateCcw, Sun, Trash2, Type } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultAppearanceSettings, resetWallpaperControls } from "../../core/state/schemas";
import type { AppearanceSettingsDto, WallpaperSlot } from "../../shared/appearance-contracts";
import { Dialog } from "./Dialog";

type Props = {
  readonly appearance: AppearanceSettingsDto;
  readonly busy: boolean;
  readonly onActivateWallpaper: (slot: WallpaperSlot) => void;
  readonly onClose: () => void;
  readonly onDeleteWallpaper: (slot: WallpaperSlot) => void;
  readonly onImportWallpaper: (slot: WallpaperSlot) => void;
  readonly onUpdate: (appearance: AppearanceSettingsDto) => void;
  readonly wallpaper: {
    readonly slots: readonly (string | null)[];
    readonly activeSlot: WallpaperSlot | null;
  };
};

type AppearanceTab = "theme" | "wallpaper" | "font";

type NumericControlKey =
  | "temperature"
  | "saturation"
  | "contrast"
  | "scale"
  | "opacity"
  | "blur"
  | "positionX"
  | "positionY";

type NumericControl = {
  readonly key: NumericControlKey;
  readonly label: string;
  readonly fromAppearance: (appearance: AppearanceSettingsDto) => number;
  readonly toAppearance: (value: number) => number;
};

const clamp = (value: number): number => Math.min(100, Math.max(0, value));
const round = (value: number): number => Math.round(value);

const NUMERIC_CONTROLS: readonly NumericControl[] = [
  {
    key: "temperature",
    label: "色温",
    fromAppearance: (appearance) => round((appearance.temperature + 100) / 2),
    toAppearance: (value) => value * 2 - 100,
  },
  {
    key: "saturation",
    label: "饱和度",
    fromAppearance: (appearance) => round(appearance.saturation / 2),
    toAppearance: (value) => value * 2,
  },
  {
    key: "contrast",
    label: "对比度",
    fromAppearance: (appearance) => round(appearance.contrast / 2),
    toAppearance: (value) => value * 2,
  },
  {
    key: "scale",
    label: "缩放",
    fromAppearance: (appearance) => round(appearance.scale - 50),
    toAppearance: (value) => value + 50,
  },
  {
    key: "opacity",
    label: "透明度",
    fromAppearance: (appearance) => appearance.opacity,
    toAppearance: (value) => value,
  },
  {
    key: "blur",
    label: "模糊度",
    fromAppearance: (appearance) => round(appearance.blur / 0.4),
    toAppearance: (value) => round(value * 0.4),
  },
  {
    key: "positionX",
    label: "左右移动",
    fromAppearance: (appearance) => appearance.positionX,
    toAppearance: (value) => value,
  },
  {
    key: "positionY",
    label: "上下移动",
    fromAppearance: (appearance) => appearance.positionY,
    toAppearance: (value) => value,
  },
];

const WALLPAPER_SLOTS: readonly WallpaperSlot[] = [0, 1, 2, 3, 4];

type HslaColor = {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
  readonly alpha: number;
};

type FontColorControl = {
  readonly fieldLabel: string;
  readonly key: "navigationFontColor" | "patchCardFontColor";
  readonly label: string;
  readonly testId: string;
};

const FONT_COLOR_CONTROLS: readonly FontColorControl[] = [
  {
    fieldLabel: "导航栏颜色",
    key: "navigationFontColor",
    label: "导航栏",
    testId: "navigation-font-color-picker",
  },
  {
    fieldLabel: "补丁卡片颜色",
    key: "patchCardFontColor",
    label: "补丁卡片",
    testId: "patch-card-font-color-picker",
  },
];

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const base = normalizedLightness - chroma / 2;
  const [red, green, blue] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return [
    Math.round((red + base) * 255),
    Math.round((green + base) * 255),
    Math.round((blue + base) * 255),
  ];
}

function hexToHsla(hex: string): HslaColor | null {
  const cleaned = hex.replace(/^#/u, "").toUpperCase();
  const expanded =
    cleaned.length === 3 || cleaned.length === 4
      ? [...cleaned].map((character) => character + character).join("")
      : cleaned;
  const opaque = expanded.length === 6 ? `${expanded}FF` : expanded;
  if (!/^[A-F0-9]{8}$/u.test(opaque)) return null;
  const red = Number.parseInt(opaque.slice(0, 2), 16) / 255;
  const green = Number.parseInt(opaque.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(opaque.slice(4, 6), 16) / 255;
  const alpha = Number.parseInt(opaque.slice(6, 8), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  return {
    hue: Math.round((((hue * 60) % 360) + 360) % 360),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100),
    alpha: Math.round(alpha * 100),
  };
}

function hslaToHex8(color: HslaColor): string {
  const [red, green, blue] = hslToRgb(color.hue, color.saturation, color.lightness);
  const alpha = Math.round((color.alpha / 100) * 255);
  const toHex = (value: number): string => value.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}${toHex(alpha)}`;
}

function FontColorPicker({
  color,
  defaultValue,
  label,
  testId,
  onChange,
}: {
  readonly color: string;
  readonly defaultValue: string;
  readonly label: string;
  readonly testId: string;
  readonly onChange: (color: string) => void;
}): React.JSX.Element {
  const [draftColor, setDraftColor] = useState(color);
  const [dragColor, setDragColor] = useState(
    () =>
      hexToHsla(color) ?? {
        hue: 0,
        saturation: 0,
        lightness: 100,
        alpha: 100,
      },
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  useEffect(() => {
    const next = hexToHsla(color) ?? { hue: 0, saturation: 0, lightness: 100, alpha: 100 };
    setDragColor(next);
    setDraftColor(hslaToHex8(next));
  }, [color]);

  const update = useCallback(
    (next: HslaColor): void => {
      setDragColor(next);
      const hex = hslaToHex8(next);
      setDraftColor(hex);
      onChange(hex);
    },
    [onChange],
  );

  const applyWheelPoint = useCallback(
    (clientX: number, clientY: number, element: HTMLElement): void => {
      const bounds = element.getBoundingClientRect();
      const center = bounds.width / 2;
      const x = clientX - bounds.left - center;
      const y = clientY - bounds.top - center;
      const distance = Math.min(Math.hypot(x, y), center - 1);
      const hue = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
      update({
        hue,
        saturation: Math.round((distance / Math.max(center - 1, 1)) * 100),
        lightness: 100 - (Math.min(Math.hypot(x, y), center - 1) / Math.max(center - 1, 1)) * 50,
        alpha: dragColor.alpha,
      });
    },
    [dragColor.alpha, update],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const size = canvas.width;
    const center = size / 2;
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - center;
        const dy = y - center;
        const distance = Math.min(Math.hypot(dx, dy) / center, 1);
        if (distance > 1) continue;
        const hue = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
        const [red, green, blue] = hslToRgb(hue, distance * 100, 100 - distance * 50);
        const offset = (y * size + x) * 4;
        image.data[offset] = red;
        image.data[offset + 1] = green;
        image.data[offset + 2] = blue;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, []);

  return (
    <div className="appearance-font-color-picker" data-testid={testId}>
      <div className="appearance-font-color-picker-body">
        <div
          className="appearance-color-wheel"
          onLostPointerCapture={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            draggingRef.current = true;
            applyWheelPoint(event.clientX, event.clientY, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (draggingRef.current)
              applyWheelPoint(event.clientX, event.clientY, event.currentTarget);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
        >
          <canvas height={200} ref={canvasRef} width={200} />
          <span
            aria-hidden="true"
            className="appearance-color-wheel-pointer"
            style={{
              left: `${50 + Math.cos((dragColor.hue * Math.PI) / 180) * (dragColor.saturation / 100) * 50}%`,
              top: `${50 + Math.sin((dragColor.hue * Math.PI) / 180) * (dragColor.saturation / 100) * 50}%`,
            }}
          />
        </div>
      </div>
      <div className="appearance-color-row">
        <div className="appearance-color-alpha-label">
          <span>色相</span>
          <output>{dragColor.hue}°</output>
        </div>
        <input
          aria-label={`${label}色相`}
          max={360}
          min={0}
          style={{
            background:
              "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
          }}
          onChange={(event) => update({ ...dragColor, hue: Number(event.currentTarget.value) })}
          type="range"
          value={dragColor.hue}
        />
      </div>
      <div className="appearance-color-row">
        <div className="appearance-color-alpha-label">
          <span>透明度</span>
          <output>{dragColor.alpha}%</output>
        </div>
        <input
          aria-label={`${label}透明度`}
          max={100}
          min={0}
          onChange={(event) => update({ ...dragColor, alpha: Number(event.currentTarget.value) })}
          style={{
            background: `linear-gradient(to right, transparent, ${hslaToHex8({ ...dragColor, alpha: 100 }).slice(0, 7)})`,
          }}
          type="range"
          value={dragColor.alpha}
        />
      </div>
      <div className="appearance-font-color-value">
        <span
          aria-hidden="true"
          className="appearance-font-color-swatch checkered-pattern"
          style={{ background: color }}
        />
        <input
          aria-label={`${label}颜色`}
          maxLength={9}
          onChange={(event) => {
            const next = event.currentTarget.value.toUpperCase();
            setDraftColor(next);
            const parsed = hexToHsla(next);
            if (parsed !== null) update(parsed);
          }}
          onBlur={() => {
            if (hexToHsla(draftColor) === null) setDraftColor(color);
          }}
          spellCheck={false}
          type="text"
          value={draftColor}
        />
        <button
          aria-label="重置颜色和透明度"
          className="appearance-color-reset"
          onClick={() =>
            update(
              hexToHsla(defaultValue) ?? {
                hue: 0,
                saturation: 0,
                lightness: 100,
                alpha: 100,
              },
            )
          }
          title="重置颜色和透明度"
          type="button"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}

function FontColorWorkspace({
  activeKey,
  appearance,
  onActiveKeyChange,
  onUpdate,
}: {
  readonly activeKey: FontColorControl["key"];
  readonly appearance: AppearanceSettingsDto;
  readonly onActiveKeyChange: (key: FontColorControl["key"]) => void;
  readonly onUpdate: (appearance: AppearanceSettingsDto) => void;
}): React.JSX.Element {
  const activeControl = FONT_COLOR_CONTROLS.find((control) => control.key === activeKey);
  if (activeControl === undefined) throw new Error("Unknown font color target");
  return (
    <div className="appearance-font-colors">
      <div className="appearance-font-targets">
        <span className="appearance-font-target-label">选择配置目标</span>
        <div aria-label="颜色目标" className="appearance-font-tabs" role="tablist">
          {FONT_COLOR_CONTROLS.map((control) => {
            const active = control.key === activeKey;
            const parsed = hexToHsla(appearance[control.key]);
            return (
              <button
                aria-selected={active}
                className="appearance-font-tab"
                data-active={active}
                key={control.key}
                onClick={() => onActiveKeyChange(control.key)}
                role="tab"
                type="button"
              >
                <span aria-hidden="true" className="checkered-pattern appearance-tab-dot">
                  <span
                    className="appearance-tab-dot-color"
                    style={{ background: appearance[control.key] }}
                  />
                </span>
                <span className="appearance-font-tab-name">{control.label}</span>
                <output className="appearance-font-tab-meta">
                  {appearance[control.key].slice(1, 7).toUpperCase()} · {parsed?.alpha ?? 100}%
                </output>
              </button>
            );
          })}
        </div>
      </div>
      <FontColorPicker
        color={appearance[activeControl.key]}
        defaultValue={defaultFontColor(activeControl.key, appearance)}
        label={activeControl.label}
        onChange={(color) => onUpdate({ ...appearance, [activeControl.key]: color })}
        testId={activeControl.testId}
      />
    </div>
  );
}

function defaultFontColor(key: FontColorControl["key"], appearance: AppearanceSettingsDto): string {
  return appearance.theme === "high-contrast" ? "#FFFFFFFF" : defaultAppearanceSettings()[key];
}

const THEME_OPTIONS: readonly {
  readonly label: string;
  readonly previewClassName: string;
  readonly value: AppearanceSettingsDto["theme"];
}[] = [
  { label: "默认界面", previewClassName: "preview-halo", value: "halo" },
  { label: "透明玻璃", previewClassName: "preview-glass", value: "glass" },
  { label: "高对比度", previewClassName: "preview-high-contrast", value: "high-contrast" },
];

function WallpaperItem({
  busy,
  onActivate,
  onDelete,
  onImport,
  slot,
  wallpaper,
}: {
  readonly busy: boolean;
  readonly onActivate: (slot: WallpaperSlot) => void;
  readonly onDelete: (slot: WallpaperSlot) => void;
  readonly onImport: (slot: WallpaperSlot) => void;
  readonly slot: WallpaperSlot;
  readonly wallpaper: {
    readonly slots: readonly (string | null)[];
    readonly activeSlot: WallpaperSlot | null;
  };
}): React.JSX.Element {
  const assetName = wallpaper.slots[slot] ?? null;
  const active = wallpaper.activeSlot === slot;

  return (
    <div className="appearance-wallpaper-item" data-active={active} data-slot={slot}>
      <button
        aria-label={assetName === null ? `选择壁纸 ${slot + 1}` : `壁纸 ${slot + 1}`}
        className="appearance-wallpaper-select"
        disabled={busy}
        onClick={() => (assetName === null ? onImport(slot) : onActivate(slot))}
        type="button"
      >
        {assetName === null ? (
          <span
            aria-hidden="true"
            className="appearance-wallpaper-placeholder"
            data-testid="wallpaper-placeholder"
          >
            <Plus size={20} />
          </span>
        ) : (
          <img alt={`壁纸 ${slot + 1}`} src={`dnf-asset://wallpaper/${assetName}`} />
        )}
      </button>
      {assetName === null ? null : (
        <div className="appearance-wallpaper-actions">
          <button
            aria-label={`删除壁纸 ${slot + 1}`}
            className="icon-button compact appearance-wallpaper-delete"
            disabled={busy}
            onClick={() => onDelete(slot)}
            type="button"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export function AppearanceDialog(props: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AppearanceTab>("wallpaper");
  const [activeFontColorKey, setActiveFontColorKey] =
    useState<FontColorControl["key"]>("navigationFontColor");

  const restoreDefaultWallpaperControls = (): void => {
    props.onUpdate(resetWallpaperControls(props.appearance));
  };

  const updateNumericControl = (control: NumericControl, value: number): void => {
    const normalized = clamp(value);
    props.onUpdate({
      ...props.appearance,
      [control.key]: control.toAppearance(normalized),
    });
  };

  const wheelNumericControl = (
    event: React.WheelEvent<HTMLInputElement>,
    control: NumericControl,
  ): void => {
    event.preventDefault();
    const current = control.fromAppearance(props.appearance);
    const delta = event.deltaY < 0 ? 2 : -2;
    updateNumericControl(control, current + delta);
  };

  return (
    <Dialog
      backdropClassName="appearance-dialog-backdrop"
      className="appearance-dialog-panel"
      closeOnBackdrop
      hideHeader
      onClose={props.onClose}
      title="调整外观"
    >
      <div className="appearance-dialog-body">
        <nav aria-label="外观设置导航" className="appearance-nav">
          <button
            aria-pressed={activeTab === "theme"}
            className="appearance-nav-button"
            onClick={() => setActiveTab("theme")}
            type="button"
          >
            <Sun size={14} />
            外观主题
          </button>
          <button
            aria-pressed={activeTab === "wallpaper"}
            className="appearance-nav-button"
            data-dialog-initial-focus
            onClick={() => setActiveTab("wallpaper")}
            type="button"
          >
            <ImageIcon size={14} />
            静态壁纸
          </button>
          <button
            aria-pressed={activeTab === "font"}
            className="appearance-nav-button"
            onClick={() => setActiveTab("font")}
            type="button"
          >
            <Type size={14} />
            字体外观
          </button>
        </nav>

        {activeTab === "theme" ? (
          <section aria-label="外观主题" className="appearance-panel appearance-theme-panel">
            <div className="appearance-theme-grid">
              {THEME_OPTIONS.map((theme) => (
                <button
                  aria-pressed={props.appearance.theme === theme.value}
                  className="appearance-theme-card"
                  data-active={props.appearance.theme === theme.value}
                  key={theme.value}
                  onClick={() => props.onUpdate({ ...props.appearance, theme: theme.value })}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`appearance-theme-thumb ${theme.previewClassName}`}
                  >
                    <span className="appearance-theme-mini-header" />
                    <span className="appearance-theme-mini-body">
                      <span className="appearance-theme-mini-sidebar" />
                      <span className="appearance-theme-mini-content" />
                    </span>
                  </span>
                  <span className="appearance-theme-name">{theme.label}</span>
                </button>
              ))}
            </div>
          </section>
        ) : activeTab === "font" ? (
          <section aria-label="字体外观" className="appearance-panel appearance-font-panel">
            <FontColorWorkspace
              activeKey={activeFontColorKey}
              appearance={props.appearance}
              onActiveKeyChange={setActiveFontColorKey}
              onUpdate={props.onUpdate}
            />
          </section>
        ) : (
          <section aria-labelledby="appearance-wallpaper-title" className="appearance-panel">
            <div className="appearance-wallpaper-layout">
              <div className="appearance-wallpaper-slots">
                {WALLPAPER_SLOTS.map((slot) => (
                  <WallpaperItem
                    busy={props.busy}
                    key={slot}
                    onActivate={props.onActivateWallpaper}
                    onDelete={props.onDeleteWallpaper}
                    onImport={props.onImportWallpaper}
                    slot={slot}
                    wallpaper={props.wallpaper}
                  />
                ))}
              </div>

              <section className="appearance-adjust-panel">
                <header className="appearance-panel-header">
                  <h3 id="appearance-wallpaper-title">壁纸微调参数</h3>
                  <button
                    className="appearance-reset-button"
                    onClick={restoreDefaultWallpaperControls}
                    title="恢复默认"
                    type="button"
                  >
                    <RotateCcw size={11} />
                    恢复默认
                  </button>
                </header>
                <div className="appearance-controls-list">
                  {NUMERIC_CONTROLS.map((control) => (
                    <label className="appearance-control-row" key={control.key}>
                      <span>{control.label}</span>
                      <input
                        max={100}
                        min={0}
                        onChange={(event) =>
                          updateNumericControl(control, Number(event.currentTarget.value))
                        }
                        onWheel={(event) => wheelNumericControl(event, control)}
                        type="range"
                        value={control.fromAppearance(props.appearance)}
                      />
                      <output>{control.fromAppearance(props.appearance)}</output>
                    </label>
                  ))}
                </div>
              </section>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
