#!/usr/bin/env bash
# 一键发版：校验 → 打 tag → 推送（触发镜像构建）→ 创建 GitHub Release
# 用法: ./scripts/release.sh <version>   例如 ./scripts/release.sh 1.0.3
set -euo pipefail

REPO="sooua/wicket"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "用法: scripts/release.sh <version>   例如 scripts/release.sh 1.0.3"
  exit 1
fi
VERSION="${VERSION#v}"          # 容忍传入 v1.0.3
TAG="v$VERSION"

# 切到仓库根目录
cd "$(dirname "$0")/.."

command -v gh >/dev/null 2>&1 || { echo "需要 GitHub CLI (gh)，请先安装并 gh auth login"; exit 1; }

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || { echo "请在 main 分支发版（当前: $branch）"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "工作区有未提交改动，请先提交"; exit 1; }

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag $TAG 已存在，换一个版本号"; exit 1
fi

grep -q "^## \[$VERSION\]" CHANGELOG.md || {
  echo "CHANGELOG.md 缺少 ## [$VERSION] 小节，请先补充再发版"; exit 1
}

# 从 CHANGELOG 抽取该版本小节作为 Release 说明（用 index 前缀匹配，避免正则元字符与优先级问题）
NOTES="$(awk -v target="## [$VERSION]" '
  index($0, target) == 1 { flag = 1; next }
  flag && index($0, "## [") == 1 { exit }
  flag { print }
' CHANGELOG.md | sed '/./,$!d')"

echo "==== 即将发布 $TAG ===="
printf '%s\n' "$NOTES"
echo "======================="
read -r -p "确认发布? [y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "已取消"; exit 1; }

git pull --ff-only origin main
git tag -a "$TAG" -m "Wicket $TAG"
git push origin "$TAG"

printf '%s\n' "$NOTES" | gh release create "$TAG" --repo "$REPO" --title "Wicket $TAG" --latest --notes-file -

echo "✓ 发布完成: https://github.com/$REPO/releases/tag/$TAG"
echo "  镜像构建进度: https://github.com/$REPO/actions"
