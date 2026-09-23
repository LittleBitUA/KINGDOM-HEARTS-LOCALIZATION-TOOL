#!/bin/sh
# Збірка проксі-DLL. Потрібен zig (https://ziglang.org) — він несе з собою
# mingw-заголовки, тож Visual Studio не треба.
set -e
cd "$(dirname "$0")"
zig cc -target x86_64-windows-gnu -O2 -shared \
  -o dinput8.dll kh1_name_grid.c exports.def
echo "зібрано: $(pwd)/dinput8.dll"
