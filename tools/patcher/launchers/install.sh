#!/bin/sh
# Запуск українізатора на Linux і Steam Deck.
# Архів міг приїхати без біта «виконуваний» — ставимо його самі.
set -e
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bin="$dir/KH-UA-Patcher"

if [ ! -f "$bin" ]; then
  echo "Поруч немає файла KH-UA-Patcher — розпакуйте архів цілком."
  exit 1
fi
chmod +x "$bin" 2>/dev/null || true

# На Steam Deck тека гри може бути на SD-картці; програма знайде її сама.
exec "$bin" "$@"
