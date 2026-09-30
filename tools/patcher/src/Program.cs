using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace KhUa
{
    // Консольний встановлювач українізатора. Одна самодостатня програма на
    // Windows і на Linux/Steam Deck: знаходить гру, робить резервну копію,
    // застосовує .pcpatch кодом KHPCPatchManager і пише журнал.
    public static class Program
    {
        public const string Version = "1.0";
        static TextWriter Screen;          // справжня консоль (Console.Out ми відводимо в журнал)
        static string LogPath;

        static int Main(string[] args)
        {
            // IBM437 для DotNetZip — без нього не читається жоден .pcpatch.
            try { Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance); } catch { }
            try { Console.OutputEncoding = new UTF8Encoding(false); } catch { }
            Screen = Console.Out;

            var a = new Args(args);
            if (a.Has("cli"))
            {
                // Повний режим самого KHPCPatchManager: розпакувати .hed, зібрати патч тощо.
                EnsureResources();
                KHPCPatchManager.CliMain(a.Rest("cli"));
                return 0;
            }
            if (a.Has("допомога", "help", "h", "?")) { Help(); return 0; }

            Head();
            try
            {
                int code = Run(a);
                Pause(a);
                return code;
            }
            catch (Exception e)
            {
                Restore();
                Err(e.Message);
                if (LogPath != null)
                {
                    try { File.AppendAllText(LogPath, e.ToString() + Environment.NewLine); } catch { }
                    Say("Подробиці — у журналі: " + LogPath);
                }
                Pause(a);
                return 1;
            }
        }

        // ------------------------------------------------------------ хід роботи

        static int Run(Args a)
        {
            string exeDir = ExeDir();
            EnsureResources();

            // Патчі: з аргументів → з теки patches/ поруч → поруч із програмою.
            var patches = a.Positional.Where(IsPatch).Select(Path.GetFullPath).ToList();
            if (patches.Count == 0) patches = Scan(Path.Combine(exeDir, "patches"));
            if (patches.Count == 0) patches = Scan(exeDir);
            if (patches.Count == 0)
            {
                Err("не знайдено жодного файла патчу (.kh1pcpatch, .compcpatch, .bbspcpatch, .dddpcpatch).");
                Say("Покладіть його в теку patches/ поруч із програмою — і запустіть ще раз.");
                return 1;
            }

            // Патчі різних ігор застосовуємо по черзі, кожен у свою збірку.
            var byType = new Dictionary<string, List<string>>();
            foreach (var p in patches)
            {
                string t = PatchApplier.TypeOf(p);
                if (t == null) continue;
                if (!byType.ContainsKey(t)) byType[t] = new List<string>();
                byType[t].Add(p);
            }

            if (a.Has("список", "list"))
            {
                foreach (var kv in byType)
                {
                    Say("");
                    Say(PatchApplier.TypeName[kv.Key] + ":");
                    var found = GameFinder.FindAll(PatchApplier.KhFiles[kv.Key]);
                    if (found.Count == 0) Say("  гру не знайдено");
                    foreach (var g in found) Say("  " + g);
                }
                return 0;
            }

            int bad = 0;
            foreach (var kv in byType)
            {
                Say("");
                Line();
                Say(PatchApplier.TypeName[kv.Key]);
                foreach (var f in kv.Value) Say("  патч: " + Path.GetFileName(f) + "  (" + Mb(new FileInfo(f).Length) + ")");

                GameInstall game = Locate(kv.Key, a);
                if (game == null) { bad++; continue; }
                Say("  гра:  " + game.ImageDir + "   [" + game.Source + "]");

                if (a.Has("відкотити", "restore"))
                {
                    var r = PatchApplier.Restore(game.ImageDir, kv.Key, Say);
                    Ok("Повернуто оригінальних архівів: " + r.Patched.Count);
                    foreach (var f in r.Failed) { Err(f); bad++; }
                    continue;
                }

                if (!Confirm(a, "Застосувати патч? Гра має бути закрита.")) { Say("  пропущено"); continue; }
                if (!SpaceOk(game, kv.Key) && !Confirm(a, "Продовжити попри це?")) { bad++; continue; }

                bad += PatchOne(game, kv.Value, kv.Key, !a.Has("без-копії", "no-backup"));
            }
            return bad == 0 ? 0 : 1;
        }

        static int PatchOne(GameInstall game, List<string> files, string type, bool keepBackup)
        {
            Say("");
            StartLog();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            PatchApplier.Result r;
            try
            {
                r = PatchApplier.Apply(game.ImageDir, files, type, keepBackup, Say, Progress);
            }
            finally
            {
                Restore();
                ClearLine();
            }

            foreach (var s in r.Skipped) Say("  ‣ " + s);
            foreach (var f in r.Failed) Err(f);
            if (r.Patched.Count > 0)
            {
                Ok("Готово за " + (int)sw.Elapsed.TotalSeconds + " с. Перезібрано архівів: " +
                   r.Patched.Count + " (" + string.Join(", ", r.Patched) + ").");
                if (keepBackup) Say("  Оригінали лишились у " + Path.Combine(game.ImageDir, "backup"));
            }
            return r.Failed.Count > 0 || r.Patched.Count == 0 ? 1 : 0;
        }

        // ------------------------------------------------------------ гра

        static GameInstall Locate(string type, Args a)
        {
            string manual = a.Value("гра") ?? a.Value("game") ?? Environment.GetEnvironmentVariable("KH_GAME_DIR");
            var pkgs = PatchApplier.KhFiles[type];

            if (!string.IsNullOrEmpty(manual))
            {
                var g = GameFinder.Inspect(manual, pkgs, "вручну");
                if (g != null) return g;
                Err("у вказаній теці немає файлів цієї гри: " + manual);
                return null;
            }

            var found = GameFinder.FindAll(pkgs);
            if (found.Count == 1) return found[0];
            if (found.Count > 1)
            {
                Say("  Знайдено кілька встановлень:");
                for (int i = 0; i < found.Count; i++) Say("    " + (i + 1) + ") " + found[i]);
                if (a.Has("так", "yes", "y")) { Say("  беремо перше"); return found[0]; }
                Screen.Write("  Номер (Enter — перше): ");
                string s = Console.ReadLine();
                int n;
                if (int.TryParse((s ?? "").Trim(), out n) && n >= 1 && n <= found.Count) return found[n - 1];
                return found[0];
            }

            Err("гру не знайдено автоматично.");
            if (a.Has("так", "yes", "y")) return null;
            Say("Вкажіть теку, де лежать " + pkgs[0] + ".pkg та інші — зазвичай це");
            Say("  …/KINGDOM HEARTS -HD 1.5+2.5 ReMIX-/Image/dt");
            Say("Можна перетягнути теку сюди й натиснути Enter (порожньо — скасувати):");
            Screen.Write("> ");
            string dir = (Console.ReadLine() ?? "").Trim().Trim('"').Trim('\'');
            if (dir.Length == 0) return null;
            var manualGame = GameFinder.Inspect(dir, pkgs, "вручну");
            if (manualGame == null) Err("у цій теці файлів гри немає: " + dir);
            return manualGame;
        }

        // Перезбирання пише новий .pkg поряд зі старим — місця треба приблизно
        // стільки ж, скільки важать самі архіви.
        static bool SpaceOk(GameInstall game, string type)
        {
            try
            {
                long need = 0;
                foreach (var n in game.Found)
                {
                    var f = new FileInfo(Path.Combine(game.ImageDir, n + ".pkg"));
                    if (f.Exists) need += f.Length;
                }
                var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(game.ImageDir)));
                long free = drive.AvailableFreeSpace;
                if (free >= need + 200L * 1024 * 1024) return true;
                Warn("на диску вільно " + Mb(free) + ", а для перезбирання треба близько " + Mb(need) + ".");
                return false;
            }
            catch { return true; }
        }

        // ------------------------------------------------------------ ресурси і журнал

        static string ExeDir()
        {
            string p = Environment.ProcessPath;
            return string.IsNullOrEmpty(p) ? AppContext.BaseDirectory : Path.GetDirectoryName(p);
        }

        // Списки імен файлів гри мають лежати в теці resources/ поруч із програмою:
        // саме звідти їх читає OpenKH (і саме тому їх не можна просто забути).
        static void EnsureResources()
        {
            string dir = Path.Combine(ExeDir(), "resources");
            string custom = Path.Combine(dir, "custom_filenames.txt");
            try
            {
                if (!File.Exists(Path.Combine(dir, "kh2idx.txt")))
                {
                    string cwd = Directory.GetCurrentDirectory();
                    try
                    {
                        Directory.SetCurrentDirectory(ExeDir());
                        KHPCPatchManager.UpdateResources();
                    }
                    finally { Directory.SetCurrentDirectory(cwd); }
                }
                if (!File.Exists(custom)) File.WriteAllText(custom, "");
            }
            catch (Exception e)
            {
                throw new InvalidOperationException(
                    "не вдалося підготувати теку resources/ поруч із програмою (" + e.Message + "). " +
                    "Розпакуйте архів у теку, куди можна писати — наприклад, у Завантаження.");
            }

            // Тимчасові файли KHPCPatchManager (custom_hd_assets.txt) лягають
            // у поточну теку — відводимо її вбік, щоб не смітити в грі.
            try
            {
                string tmp = Path.Combine(Path.GetTempPath(), "kh-ua-patcher");
                Directory.CreateDirectory(tmp);
                Directory.SetCurrentDirectory(tmp);
            }
            catch { }
        }

        // Сам патчер друкує тисячі рядків про кожен файл — вони йдуть у журнал,
        // а на екрані лишається тільки поступ.
        static void StartLog()
        {
            try
            {
                LogPath = Path.Combine(ExeDir(), "patch-log.txt");
                var w = new StreamWriter(LogPath, true, new UTF8Encoding(false)) { AutoFlush = true };
                w.WriteLine();
                w.WriteLine("=== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " ===");
                Console.SetOut(w);
            }
            catch { LogPath = null; }
        }

        static void Restore()
        {
            if (Screen == null) return;
            var cur = Console.Out;
            if (!ReferenceEquals(cur, Screen))
            {
                Console.SetOut(Screen);
                try { cur.Flush(); cur.Dispose(); } catch { }
            }
        }

        // ------------------------------------------------------------ екран

        static int lastLen;
        static int lastPercent = -1;
        // Патчер звітує про кожен файл окремо — на екран виводимо лише відсотки,
        // і лише коли вони змінились (інакше це тисячі рядків на один архів).
        static void Progress(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            int percent = -1;
            var m = System.Text.RegularExpressions.Regex.Match(text, @"(\d+)/(\d+)\s*$");
            if (m.Success)
            {
                long done = long.Parse(m.Groups[1].Value), all = long.Parse(m.Groups[2].Value);
                if (all > 0) percent = (int)(100 * done / all);
                if (percent == lastPercent) return;
                lastPercent = percent;
                text = text.Substring(0, m.Index) + percent + "%";
            }
            string s = "  " + text;
            if (s.Length > 78) s = s.Substring(0, 78);
            if (Console.IsOutputRedirected) { Screen.WriteLine(s); return; }
            Screen.Write("\r" + s.PadRight(Math.Max(lastLen, s.Length)));
            lastLen = s.Length;
        }
        static void ClearLine()
        {
            if (lastLen == 0) return;
            Screen.Write("\r" + new string(' ', lastLen) + "\r");
            lastLen = 0;
        }

        static void Say(string s) { ClearLine(); Screen.WriteLine(s); }
        static void Line() { Screen.WriteLine(new string('─', 60)); }
        static void Tint(ConsoleColor c, string prefix, string s)
        {
            ClearLine();
            try { Console.ForegroundColor = c; } catch { }
            Screen.Write(prefix);
            try { Console.ResetColor(); } catch { }
            Screen.WriteLine(s);
        }
        static void Ok(string s) { Tint(ConsoleColor.Green, "  ✓ ", s); }
        static void Warn(string s) { Tint(ConsoleColor.Yellow, "  ! ", s); }
        static void Err(string s) { Tint(ConsoleColor.Red, "  ✗ ", s); }

        static void Head()
        {
            Screen.WriteLine();
            // Назва навмисне про інструмент, а не про конкретний переклад:
            // сама програма перекладу не містить, його кладуть у patches/.
            Screen.WriteLine("ВСТАНОВЛЮВАЧ ПАТЧІВ KINGDOM HEARTS   " + Version +
                             "   (" + (OperatingSystem.IsWindows() ? "Windows" : "Linux") + ")");
            Line();
        }

        static void Help()
        {
            Head();
            Screen.WriteLine("Запуск без аргументів: сам знайде гру й застосує патчі з теки patches/.");
            Screen.WriteLine();
            Screen.WriteLine("  --гра <тека>     тека гри (та, де лежать kh1_first.pkg тощо, або корінь збірки)");
            Screen.WriteLine("  --відкотити      повернути оригінали з backup/");
            Screen.WriteLine("  --без-копії      прибрати резервну копію після патчу");
            Screen.WriteLine("  --так            нічого не питати");
            Screen.WriteLine("  --список         показати знайдені встановлення й вийти");
            Screen.WriteLine("  --cli <аргументи> режим KHPCPatchManager (розпакувати .hed, зібрати патч)");
            Screen.WriteLine();
            Screen.WriteLine("Змінна оточення KH_GAME_DIR робить те саме, що --гра.");
        }

        static bool Confirm(Args a, string q)
        {
            if (a.Has("так", "yes", "y") || Console.IsInputRedirected) return true;
            ClearLine();
            Screen.Write("  " + q + " [Y/n] ");
            string s = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
            return s.Length == 0 || s == "y" || s == "т" || s == "yes" || s == "так";
        }

        // Пауза наприкінці — окремо від --так. Пускач запускає програму без
        // запитань, але вікно має дочекатись, поки людина прочитає підсумок,
        // інакше воно просто зникне.
        static void Pause(Args a)
        {
            if (a.Has("без-паузи", "no-pause") || Console.IsInputRedirected) return;
            Screen.WriteLine();
            Screen.Write("Натисніть Enter, щоб закрити…");
            try { Console.ReadLine(); } catch { }
        }

        // ------------------------------------------------------------ дрібниці

        static bool IsPatch(string p) { return PatchApplier.TypeOf(p) != null && File.Exists(p); }

        static List<string> Scan(string dir)
        {
            var outp = new List<string>();
            try
            {
                foreach (var f in Directory.GetFiles(dir))
                    if (PatchApplier.TypeOf(f) != null) outp.Add(Path.GetFullPath(f));
            }
            catch { }
            outp.Sort(StringComparer.OrdinalIgnoreCase);
            return outp;
        }

        static string Mb(long b)
        {
            if (b >= 1073741824L) return (b / 1073741824.0).ToString("0.0") + " ГБ";
            return (b / 1048576.0).ToString("0") + " МБ";
        }

        // Розбір аргументів: ключі з «--», решта — позиційні.
        sealed class Args
        {
            readonly string[] raw;
            public readonly List<string> Positional = new List<string>();
            public Args(string[] args)
            {
                raw = args;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i].StartsWith("-")) { if (TakesValue(args[i])) i++; continue; }
                    Positional.Add(args[i]);
                }
            }
            static bool TakesValue(string k) { return Key(k) == "гра" || Key(k) == "game"; }
            static string Key(string s) { return s.TrimStart('-').ToLowerInvariant(); }

            public bool Has(params string[] names)
            {
                foreach (var r in raw) if (r.StartsWith("-") && names.Contains(Key(r))) return true;
                return false;
            }
            public string Value(string name)
            {
                for (int i = 0; i < raw.Length - 1; i++)
                    if (raw[i].StartsWith("-") && Key(raw[i]) == name) return raw[i + 1];
                return null;
            }
            // Усе після вказаного ключа — для режиму --cli.
            public string[] Rest(string name)
            {
                for (int i = 0; i < raw.Length; i++)
                    if (raw[i].StartsWith("-") && Key(raw[i]) == name) return raw.Skip(i + 1).ToArray();
                return new string[0];
            }
        }
    }
}
