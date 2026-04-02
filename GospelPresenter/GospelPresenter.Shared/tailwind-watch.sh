#!/bin/zsh
# Resolve Tailwind.MSBuild version from GospelPresenter.Shared.csproj
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
MSBUILD_VERSION=$(grep 'PackageReference Include="Tailwind.MSBuild"' "$SCRIPT_DIR/GospelPresenter.Shared.csproj" | sed 's/.*Version="\([^"]*\)".*/\1/')
TAILWIND_VERSION=$(grep '<TailwindVersion>' "$SCRIPT_DIR/GospelPresenter.Shared.csproj" | sed 's/.*<TailwindVersion>\([^<]*\)<.*/\1/')

if [ -z "$MSBUILD_VERSION" ]; then
  echo "Error: Could not find Tailwind.MSBuild version in GospelPresenter.Shared.csproj"
  exit 1
fi

if [ -z "$TAILWIND_VERSION" ]; then
  TAILWIND_VERSION="latest"
fi

TAILWIND_CLI=$(find "$HOME/.nuget/packages/tailwind.msbuild/$MSBUILD_VERSION/cli/$TAILWIND_VERSION" -name "tailwindcss-*" -type f | head -1)

if [ -z "$TAILWIND_CLI" ]; then
  echo "Error: Could not find tailwindcss binary for Tailwind.MSBuild $MSBUILD_VERSION / Tailwind $TAILWIND_VERSION"
  exit 1
fi

echo "Using: $TAILWIND_CLI"
exec "$TAILWIND_CLI" -i "$SCRIPT_DIR/tailwind-input.css" -o "$SCRIPT_DIR/wwwroot/tailwind-output.css" -w
