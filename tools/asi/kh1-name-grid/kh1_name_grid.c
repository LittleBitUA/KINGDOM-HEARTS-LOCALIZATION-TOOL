// KH1 (HD 1.5+2.5 ReMIX, PC) — порядок символів на екрані введення назви
// (пліт на Островах долі, ім'я героя).
//
// Сітка символів лежить не у файлах гри, а в самому exe: масив сторінок
// PTR_DAT_140506EF8[сторінка], кожна сторінка — послідовність пар
//   u32 позиція, u32 номер гліфа
// де позиція = ряд*0x1000 + стовпець*0x10, кінець таблиці — гліф 0xFFF6.
// Гра обмежує курсор 5 рядами (0..4) і 11 стовпцями (0..10), причому
// стовпець 0 — службовий (гліф 0xFFFF = «перестрибнути», 0 = порожньо).
// Отже на сторінку припадає 50 робочих комірок, сторінок — 5.
//
// Ця бібліотека підміняє dinput8.dll (гра його імпортує), прозоро
// перенаправляє виклики у системний dinput8.dll і на старті переписує
// номери гліфів у цих таблицях за файлом kh1font.txt поряд з exe.
// Розмір і геометрія таблиць не змінюються — тільки те, який гліф у якій
// комірці, тож жодного ризику зачепити сусідні дані нема.
//
// Збірка: build.sh (zig cc -target x86_64-windows-gnu -shared)

#include <windows.h>
#include <stdio.h>
#include <string.h>

#define MAX_PAGES   8
#define MAX_ROWS    5
#define MAX_COLS    16
#define GLYPH_KEEP  0xFFFFFFFFu   // «не чіпати цю комірку»

typedef struct {
  unsigned int *table;   // початок таблиці пар у пам'яті гри
  int entries;           // скільки пар до термінатора включно
  unsigned int first;    // номер першого гліфа в оригіналі (для впізнавання)
} Page;

static Page g_pages[MAX_PAGES];
static int g_pageCount = 0;
static unsigned int g_cfg[MAX_PAGES][MAX_ROWS][MAX_COLS];
static int g_cfgPages = 0;

// ---------------------------------------------------------------- лог ----
static wchar_t g_logPath[MAX_PATH];

static void logInit(void) {
  GetModuleFileNameW(NULL, g_logPath, MAX_PATH);
  wchar_t *slash = wcsrchr(g_logPath, L'\\');
  if (slash) slash[1] = 0;
  wcscat(g_logPath, L"kh1font.log");
  FILE *f = _wfopen(g_logPath, L"w");
  if (f) { fputs("kh1-name-grid\n", f); fclose(f); }
}

static void logf(const char *fmt, ...) {
  FILE *f = _wfopen(g_logPath, L"a");
  if (!f) return;
  va_list ap;
  va_start(ap, fmt);
  vfprintf(f, fmt, ap);
  va_end(ap);
  fputc('\n', f);
  fclose(f);
}

// ------------------------------------------------------- проксі dinput8 ----
static HMODULE g_real = NULL;

static FARPROC realProc(const char *name) {
  if (!g_real) {
    wchar_t p[MAX_PATH];
    UINT n = GetSystemDirectoryW(p, MAX_PATH);
    if (!n || n > MAX_PATH - 16) return NULL;
    wcscat(p, L"\\dinput8.dll");
    g_real = LoadLibraryW(p);
    if (!g_real) logf("ПОМИЛКА: не вдалося завантажити системний dinput8.dll");
  }
  return g_real ? GetProcAddress(g_real, name) : NULL;
}

typedef HRESULT (WINAPI *PFN_Create)(HINSTANCE, DWORD, const void *, void **, void *);
typedef HRESULT (WINAPI *PFN_NoArg)(void);
typedef HRESULT (WINAPI *PFN_GetClass)(const void *, const void *, void **);
typedef void *  (WINAPI *PFN_Getdf)(void);

__declspec(dllexport) HRESULT WINAPI DirectInput8Create(HINSTANCE hinst, DWORD ver, const void *riid, void **out, void *unk) {
  PFN_Create p = (PFN_Create)realProc("DirectInput8Create");
  return p ? p(hinst, ver, riid, out, unk) : E_FAIL;
}
__declspec(dllexport) HRESULT WINAPI kh1_DllCanUnloadNow(void) {
  PFN_NoArg p = (PFN_NoArg)realProc("DllCanUnloadNow");
  return p ? p() : S_FALSE;
}
__declspec(dllexport) HRESULT WINAPI kh1_DllGetClassObject(const void *rclsid, const void *riid, void **ppv) {
  PFN_GetClass p = (PFN_GetClass)realProc("DllGetClassObject");
  return p ? p(rclsid, riid, ppv) : E_FAIL;
}
__declspec(dllexport) HRESULT WINAPI DllRegisterServer(void) {
  PFN_NoArg p = (PFN_NoArg)realProc("DllRegisterServer");
  return p ? p() : E_FAIL;
}
__declspec(dllexport) HRESULT WINAPI DllUnregisterServer(void) {
  PFN_NoArg p = (PFN_NoArg)realProc("DllUnregisterServer");
  return p ? p() : E_FAIL;
}
__declspec(dllexport) void * WINAPI GetdfDIJoystick(void) {
  PFN_Getdf p = (PFN_Getdf)realProc("GetdfDIJoystick");
  return p ? p() : NULL;
}

// ------------------------------------------------------- пошук таблиць ----
// Сигнатура початку сторінки: пара (позиція 0, гліф 0xFFFF) + позиція 0x10.
static const unsigned char SIG[12] = { 0,0,0,0, 0xFF,0xFF,0,0, 0x10,0,0,0 };

static int scanPages(void) {
  HMODULE base = GetModuleHandleW(NULL);
  if (!base) return 0;
  IMAGE_DOS_HEADER *dos = (IMAGE_DOS_HEADER *)base;
  IMAGE_NT_HEADERS *nt = (IMAGE_NT_HEADERS *)((unsigned char *)base + dos->e_lfanew);
  unsigned char *start = (unsigned char *)base;
  size_t size = nt->OptionalHeader.SizeOfImage;
  logf("модуль 0x%p, розмір 0x%zX", (void *)base, size);

  for (size_t i = 0; i + sizeof(SIG) + 8 * 80 < size && g_pageCount < MAX_PAGES; i++) {
    if (memcmp(start + i, SIG, sizeof(SIG)) != 0) continue;
    unsigned int *t = (unsigned int *)(start + i);
    // Перевірка: у межах 80 пар має бути термінатор 0xFFF6, а позиції —
    // у діапазоні рядів 0..4 і стовпців 0..15.
    int n = -1;
    for (int k = 0; k < 80; k++) {
      unsigned int pos = t[k * 2], g = t[k * 2 + 1];
      if (g == 0xFFF6) { n = k + 1; break; }
      unsigned int row = pos >> 12, col = (pos >> 4) & 0xFF;
      if (row > 4 || col > 15) { n = -2; break; }
    }
    if (n < 4) continue;
    g_pages[g_pageCount].table = t;
    g_pages[g_pageCount].entries = n;
    g_pages[g_pageCount].first = t[3];
    logf("сторінка %d: 0x%p, пар %d, перший гліф 0x%X",
         g_pageCount + 1, (void *)t, n, t[3]);
    g_pageCount++;
    // -1, бо for-цикл додасть ще один: інакше початок наступної таблиці
    // (вони лежать упритул) проскакує повз сигнатуру.
    i += 8 * (size_t)n - 1;
  }
  return g_pageCount;
}

// -------------------------------------------------------------- конфіг ----
static int parseCell(const char *s, unsigned int *out) {
  if (s[0] == '-' && s[1] == 0) { *out = GLYPH_KEEP; return 1; }     // не чіпати
  if (s[0] == '.' && s[1] == 0) { *out = 0; return 1; }              // порожня комірка
  char *end = NULL;
  unsigned long v = strtoul(s, &end, (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) ? 16 : 10);
  if (end == s || (end && *end)) return 0;
  *out = (unsigned int)v;
  return 1;
}

static int loadConfig(void) {
  wchar_t p[MAX_PATH];
  GetModuleFileNameW(NULL, p, MAX_PATH);
  wchar_t *slash = wcsrchr(p, L'\\');
  if (slash) slash[1] = 0;
  wcscat(p, L"kh1font.txt");
  FILE *f = _wfopen(p, L"r");
  if (!f) { logf("kh1font.txt не знайдено — нічого не міняю"); return 0; }

  for (int a = 0; a < MAX_PAGES; a++)
    for (int b = 0; b < MAX_ROWS; b++)
      for (int c = 0; c < MAX_COLS; c++) g_cfg[a][b][c] = GLYPH_KEEP;

  char line[1024];
  int page = -1, row = 0;
  while (fgets(line, sizeof(line), f)) {
    char *s = line;
    while (*s == ' ' || *s == '\t') s++;
    char *nl = strpbrk(s, "\r\n");
    if (nl) *nl = 0;
    if (!*s || *s == '#' || *s == ';') continue;
    if (!_strnicmp(s, "page", 4)) {
      int n = atoi(s + 4);
      page = (n >= 1 && n <= MAX_PAGES) ? n - 1 : -1;
      row = 0;
      if (page >= 0 && page + 1 > g_cfgPages) g_cfgPages = page + 1;
      continue;
    }
    if (page < 0 || row >= MAX_ROWS) continue;
    // Комірки йдуть зі стовпця 1 (нульовий — службовий).
    int col = 1;
    char *tok = strtok(s, " \t");
    while (tok && col < MAX_COLS) {
      unsigned int g;
      if (parseCell(tok, &g)) g_cfg[page][row][col] = g;
      col++;
      tok = strtok(NULL, " \t");
    }
    row++;
  }
  fclose(f);
  logf("конфіг прочитано: сторінок %d", g_cfgPages);
  return g_cfgPages;
}

// -------------------------------------------------------------- застосування ----
static void applyConfig(void) {
  for (int pi = 0; pi < g_pageCount && pi < g_cfgPages; pi++) {
    Page *pg = &g_pages[pi];
    DWORD old = 0;
    if (!VirtualProtect(pg->table, (size_t)pg->entries * 8, PAGE_READWRITE, &old)) {
      logf("сторінка %d: VirtualProtect не вдався (%lu)", pi + 1, GetLastError());
      continue;
    }
    int changed = 0;
    for (int k = 0; k < pg->entries; k++) {
      unsigned int pos = pg->table[k * 2];
      if (pg->table[k * 2 + 1] == 0xFFF6) break;
      unsigned int row = pos >> 12, col = (pos >> 4) & 0xFF;
      if (row >= MAX_ROWS || col >= MAX_COLS) continue;
      unsigned int want = g_cfg[pi][row][col];
      if (want == GLYPH_KEEP) continue;
      if (pg->table[k * 2 + 1] == want) continue;
      pg->table[k * 2 + 1] = want;
      changed++;
    }
    VirtualProtect(pg->table, (size_t)pg->entries * 8, old, &old);
    logf("сторінка %d: змінено комірок %d", pi + 1, changed);
  }
}

// --------------------------------------------------------------- запуск ----
// Чи це взагалі KH1? У теці збірки лежать чотири гри, і dinput8.dll
// підхопить кожна з них — чіпати таблиці можна лише в KINGDOM HEARTS FINAL MIX.
static int isKh1(void) {
  wchar_t p[MAX_PATH];
  GetModuleFileNameW(NULL, p, MAX_PATH);
  wchar_t *name = wcsrchr(p, L'\\');
  name = name ? name + 1 : p;
  return wcsstr(name, L"FINAL MIX") != NULL && wcsstr(name, L"Birth by Sleep") == NULL
      && wcsstr(name, L"II") == NULL;
}

static DWORD WINAPI worker(LPVOID arg) {
  (void)arg;
  logInit();
  wchar_t exe[MAX_PATH];
  GetModuleFileNameW(NULL, exe, MAX_PATH);
  logf("процес: %S", exe);
  if (!isKh1()) { logf("не KH1 — нічого не роблю"); return 0; }
  if (!loadConfig()) return 0;
  if (!scanPages()) { logf("таблиці сітки не знайдено"); return 0; }
  applyConfig();
  logf("готово");
  return 0;
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(h);
    HANDLE t = CreateThread(NULL, 0, worker, NULL, 0, NULL);
    if (t) CloseHandle(t);
  }
  return TRUE;
}
