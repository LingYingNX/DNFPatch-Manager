#!/usr/bin/env bash
# 本地全链路试验：安装 → 应用内更新 → 卸载 → 备份放回后全新安装 → 卸载。
# 每一步都断言安装目录内的用户数据（patch-categories 补丁库与 data 配置，
# 含所有子目录与深层文件）未被删除。
# 用法：pnpm verify:nsis 或 bash scripts/verify-nsis-preservation.sh [旧版安装包路径]

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEW_INSTALLER="$PROJECT_ROOT/dist/dnf-patch-manager-1.3.0-setup.exe"
OLD_INSTALLER="${1:-$PROJECT_ROOT/dist/dnf-patch-manager-1.2.9-setup.exe}"

for file in "$NEW_INSTALLER" "$OLD_INSTALLER"; do
  if [ ! -f "$file" ]; then
    echo "✗ 缺少安装包：$file"
    echo "  先运行 pnpm dist:installer，并把上一版安装包放到 dist/（或作为参数传入）。"
    exit 1
  fi
done

NEW_VER="$(sed -n 's/.*dnf-patch-manager-\([0-9.]*\)-setup\.exe.*/\1/p' <<< "$NEW_INSTALLER")"
OLD_VER="$(sed -n 's/.*dnf-patch-manager-\([0-9.]*\)-setup\.exe.*/\1/p' <<< "$OLD_INSTALLER")"

SIM_ROOT="$(mktemp -d -t dnf-nsis-sim-XXXXXXXX)"
FAILED=0

cleanup() {
  if [ "$FAILED" = "0" ]; then
    rm -rf "$SIM_ROOT"
  else
    echo "  验证失败，保留模拟目录以便排查：$SIM_ROOT"
  fi
}
trap cleanup EXIT

fail() {
  FAILED=1
  echo "✗ $*"
  exit 1
}
pass() { echo "✓ $*"; }

# 用户数据样本：补丁库深层嵌套 + 全部配置子目录（预览/壁纸/回收站/会话）。
SEED_FILES=(
  "patch-categories/分类A/coat.npk|npk-content-coat"
  "patch-categories/分类A/子目录/hair.npk|npk-content-hair"
  "patch-categories/分类B/sword.npk|npk-content-sword"
  "patch-categories/分类B/深层/更深层/deep.npk|npk-content-deep"
  "data/installation-state.json|{\"gameDirectory\":\"D:/game\",\"appearance\":{\"theme\":\"dark\"}}"
  "data/groups.json|[{\"id\":\"g1\",\"name\":\"分组\"}]"
  "data/category-order.json|[\"分类A\",\"分类B\"]"
  "data/category-styles.json|{\"分类A\":\"music\"}"
  "data/previews/bindings.json|{\"coat.npk\":\"p1\"}"
  "data/previews/img/coat.png|png-bytes"
  "data/wallpapers/wallpapers.json|{\"activeSlot\":1}"
  "data/recycle-bin/recycle-bin.json|[]"
  "data/recycle-bin/files/trash.npk|trashed-content"
  "data/electron/session/cookies.dat|session-blob"
)

seed_user_data() { # base_dir
  local base="$1" entry rel content
  for entry in "${SEED_FILES[@]}"; do
    rel="${entry%%|*}"
    content="${entry#*|}"
    mkdir -p "$(dirname "$base/$rel")"
    printf '%s' "$content" >"$base/$rel"
  done
}

user_data_intact() { # base_dir
  local base="$1" entry rel content
  for entry in "${SEED_FILES[@]}"; do
    rel="${entry%%|*}"
    content="${entry#*|}"
    [ "$(cat "$base/$rel" 2>/dev/null)" = "$content" ] || return 1
  done
}

app_present() { [ -f "$1/DNF补丁管理器.exe" ]; }
app_gone() { ! app_present "$1"; }
app_asar_md5() { md5sum "$1/resources/app.asar" 2>/dev/null | cut -d' ' -f1; }

wait_until() { # timeout_sec predicate...
  local timeout=$1
  shift
  local waited=0
  until "$@"; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then return 1; fi
  done
}

install_silent() { # installer_win_path dest_win_dir
  powershell -NoProfile -Command \
    "Start-Process -FilePath '$1' -ArgumentList '/S','/D=$2' -Wait"
}
install_update() { # installer_win_path dest_win_dir（复刻 electron-updater 参数：--updated /S /D=）
  powershell -NoProfile -Command \
    "Start-Process -FilePath '$1' -ArgumentList '--updated','/S','/D=$2' -Wait"
}
uninstall_silent() { # dest_win_dir
  powershell -NoProfile -Command \
    "Start-Process -FilePath '$1\Uninstall DNF补丁管理器.exe' -ArgumentList '/S' -Wait"
}

echo "[1/6] 场景A：静默安装旧版 $OLD_VER（模拟已有用户）..."
SIM_A="$SIM_ROOT/install-a"
SIM_A_WIN="$(cygpath -w "$SIM_A")"
install_silent "$(cygpath -w "$OLD_INSTALLER")" "$SIM_A_WIN"
wait_until 60 app_present "$SIM_A" || fail "旧版安装后未找到应用文件"
OLD_ASAR_MD5="$(app_asar_md5 "$SIM_A")"
[ -n "$OLD_ASAR_MD5" ] || fail "旧版安装后未找到 resources/app.asar"
pass "旧版 $OLD_VER 安装完成"

echo "[2/6] 场景A：写入用户数据并模拟应用内更新到 $NEW_VER ..."
seed_user_data "$SIM_A"
install_update "$(cygpath -w "$NEW_INSTALLER")" "$SIM_A_WIN"
wait_until 120 app_present "$SIM_A" || fail "更新后未找到应用文件"
user_data_intact "$SIM_A" || fail "更新后用户数据丢失（含子目录文件）"
NEW_ASAR_MD5="$(app_asar_md5 "$SIM_A")"
if [ -n "$NEW_ASAR_MD5" ] && [ "$NEW_ASAR_MD5" != "$OLD_ASAR_MD5" ]; then
  pass "更新真实发生（app.asar 已变化），patch-categories 与 data 全部保留"
else
  fail "更新未实际写入新文件（app.asar 未变化），验证结果无效"
fi

echo "[3/6] 场景A：模拟卸载..."
uninstall_silent "$SIM_A_WIN"
wait_until 90 app_gone "$SIM_A" || fail "卸载后应用文件仍存在"
user_data_intact "$SIM_A" || fail "卸载后用户数据丢失"
pass "卸载完成：应用文件已移除，${#SEED_FILES[@]} 个用户数据文件全部保留"

echo "[4/6] 场景B：模拟手动恢复备份后全新安装 $NEW_VER ..."
SIM_B="$SIM_ROOT/install-b"
SIM_B_WIN="$(cygpath -w "$SIM_B")"
seed_user_data "$SIM_B"
install_silent "$(cygpath -w "$NEW_INSTALLER")" "$SIM_B_WIN"
wait_until 60 app_present "$SIM_B" || fail "全新安装后未找到应用文件"
user_data_intact "$SIM_B" || fail "全新安装后用户数据丢失"
pass "全新安装完成，已存在的用户数据全部保留"

echo "[5/6] 场景B：模拟卸载..."
uninstall_silent "$SIM_B_WIN"
wait_until 90 app_gone "$SIM_B" || fail "卸载后应用文件仍存在"
user_data_intact "$SIM_B" || fail "卸载后用户数据丢失"
pass "卸载完成：应用文件已移除，用户数据保留"

echo "[6/6] 全部通过：安装、更新、卸载全链路中，patch-categories 与 data"
echo "      （含所有子目录与深层文件）均未被删除。"
