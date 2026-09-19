# Ghidra-скрипти для `KINGDOM HEARTS FINAL MIX.exe`

Headless (Ghidra 12.1, JDK 21+):

```
support\analyzeHeadless.bat <proj-dir> kh1 -import "…\KINGDOM HEARTS FINAL MIX.exe" -scriptPath tools\ghidra -postScript KhDump.java
support\analyzeHeadless.bat <proj-dir> kh1 -process "KINGDOM HEARTS FINAL MIX.exe" -noanalysis -scriptPath tools\ghidra -postScript KhRefs.java
```

| скрипт | env | що робить |
|---|---|---|
| `KhDump.java` | `KH_OUT` | усі рядки exe, «цікаві» (шляхи до текстових файлів) з xref'ами, декомпіляція функцій, що їх читають |
| `KhRefs.java` | `KH_OUT`, `KH_ADDRS=hex,hex` | декомпілює всі функції, що звертаються до вказаних глобалів (+ сусіди) |
| `KhSwitch.java` | `KH_OUT`, `KH_MIN`, `KH_MAX` | функції зі switch на N..M гілок (пошук інтерпретаторів байткоду) |
| `KhScalar.java` | `KH_OUT`, `KH_VALS=hex,…` | функції з константами (magic-и) в операндах |

Знахідки — у `docs/formats/kh1-menu-text.md`.
