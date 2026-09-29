using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace KhUa
{
    // Де лежить збірка Kingdom Hearts. Шукаємо там, де вона справді буває:
    // Steam (реєстр → libraryfolders.vdf → усі диски й SD-картка Steam Deck),
    // Epic Games (маніфести лаунчера), плюс типові теки.
    //
    // Нас цікавить не корінь збірки, а тека Image/dt (у старих встановленнях
    // Image/en) — саме в ній лежать kh1_first.pkg і решта, і саме її
    // KHPCPatchManager називає «en або dt folder».
    public sealed class GameInstall
    {
        public string Root;        // тека збірки
        public string ImageDir;    // Image/dt або Image/en
        public string Source;      // Steam / Epic / вручну
        public string[] Found;     // які .pkg із потрібних тут є

        public override string ToString() { return ImageDir + "   [" + Source + "]"; }
    }

    public static class GameFinder
    {
        // Ідентифікатори у Steam: 1.5+2.5 ReMIX і 2.8 Final Chapter Prologue.
        static readonly string[] AppIds = { "2552430", "2552440" };
        static readonly string[] DirNames = {
            "KINGDOM HEARTS -HD 1.5+2.5 ReMIX-",
            "KINGDOM HEARTS HD 2.8 Final Chapter Prologue",
            "KH_1.5_2.5",
            "KH_2.8"
        };
        static readonly string[] ImageSubs = { "dt", "en" };

        static bool IsWin { get { return OperatingSystem.IsWindows(); } }

        static bool Dir(string p)
        {
            try { return !string.IsNullOrEmpty(p) && Directory.Exists(p); } catch { return false; }
        }

        // ---------------------------------------------------------- Steam

        static string RegQuery(string hive, string key, string value)
        {
            if (!IsWin) return null;
            try
            {
                var psi = new ProcessStartInfo("reg", "query \"" + hive + "\\" + key + "\" /v " + value)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var p = Process.Start(psi);
                string txt = p.StandardOutput.ReadToEnd();
                p.WaitForExit(4000);
                var m = Regex.Match(txt, @"REG_SZ\s+(.+)");
                return m.Success ? m.Groups[1].Value.Trim() : null;
            }
            catch { return null; }
        }

        static IEnumerable<string> SteamRoots()
        {
            var roots = new List<string>();
            if (IsWin)
            {
                foreach (var r in new[]{
                    RegQuery("HKCU", @"Software\Valve\Steam", "SteamPath"),
                    RegQuery("HKLM", @"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
                    RegQuery("HKLM", @"SOFTWARE\Valve\Steam", "InstallPath")
                }) if (!string.IsNullOrEmpty(r)) roots.Add(r.Replace('/', '\\'));

                foreach (var d in DriveLetters())
                    foreach (var rel in new[]{
                        "Steam", "SteamLibrary",
                        @"Program Files (x86)\Steam", @"Program Files\Steam",
                        @"Games\Steam", @"Games\SteamLibrary" })
                        roots.Add(Path.Combine(d, rel));
            }
            else
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string xdg = Environment.GetEnvironmentVariable("XDG_DATA_HOME");
                if (!string.IsNullOrEmpty(xdg)) roots.Add(Path.Combine(xdg, "Steam"));
                foreach (var rel in new[]{
                    ".steam/steam", ".steam/root", ".steam/debian-installation",
                    ".local/share/Steam",
                    ".var/app/com.valvesoftware.Steam/.local/share/Steam",   // flatpak
                    "snap/steam/common/.local/share/Steam" })
                    roots.Add(Path.Combine(home, rel));
                roots.Add("/home/deck/.local/share/Steam");

                // Steam Deck: SD-картка і зовнішні диски.
                foreach (var media in new[] { "/run/media", "/media", "/mnt" })
                {
                    if (!Dir(media)) continue;
                    foreach (var lvl1 in SafeDirs(media))
                    {
                        roots.Add(lvl1);
                        foreach (var lvl2 in SafeDirs(lvl1)) roots.Add(lvl2);
                    }
                }
            }
            return roots;
        }

        static IEnumerable<string> SafeDirs(string p)
        {
            try { return Directory.EnumerateDirectories(p); } catch { return Enumerable.Empty<string>(); }
        }

        static IEnumerable<string> DriveLetters()
        {
            for (char c = 'A'; c <= 'Z'; c++)
            {
                string d = c + ":\\";
                if (Dir(d)) yield return d;
            }
        }

        // Усі бібліотеки Steam: корінь + усе, що перелічено в libraryfolders.vdf.
        static List<string> SteamLibraries()
        {
            var libs = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Add(string p)
            {
                if (!Dir(p) || !Dir(Path.Combine(p, "steamapps"))) return;
                string k = Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar);
                if (seen.Add(k)) libs.Add(k);
            }

            foreach (var root in SteamRoots())
            {
                if (!Dir(root)) continue;
                Add(root);
                foreach (var vdf in new[]{
                    Path.Combine(root, "steamapps", "libraryfolders.vdf"),
                    Path.Combine(root, "config", "libraryfolders.vdf") })
                {
                    string txt;
                    try { txt = File.ReadAllText(vdf); } catch { continue; }
                    foreach (Match m in Regex.Matches(txt, "\"path\"\\s+\"([^\"]+)\""))
                        Add(m.Groups[1].Value.Replace("\\\\", "\\"));
                }
            }
            return libs;
        }

        static IEnumerable<string> SteamGameDirs()
        {
            foreach (var lib in SteamLibraries())
            {
                string common = Path.Combine(lib, "steamapps", "common");
                foreach (var id in AppIds)
                {
                    string acf = Path.Combine(lib, "steamapps", "appmanifest_" + id + ".acf");
                    string txt = null;
                    try { if (File.Exists(acf)) txt = File.ReadAllText(acf); } catch { }
                    if (txt == null) continue;
                    var m = Regex.Match(txt, "\"installdir\"\\s+\"([^\"]+)\"");
                    if (m.Success) yield return Path.Combine(common, m.Groups[1].Value);
                }
                foreach (var n in DirNames) yield return Path.Combine(common, n);
                // Linux розрізняє регістр, а теку могли перейменувати — дивимось
                // на все, що схоже на Kingdom Hearts.
                foreach (var d in SafeDirs(common))
                    if (Regex.IsMatch(Path.GetFileName(d), "kingdom.*hearts|^KH_", RegexOptions.IgnoreCase))
                        yield return d;
            }
        }

        // ---------------------------------------------------------- Epic

        static IEnumerable<string> EpicGameDirs()
        {
            if (!IsWin) yield break;
            string manifests = Path.Combine(
                Environment.GetEnvironmentVariable("ProgramData") ?? @"C:\ProgramData",
                "Epic", "EpicGamesLauncher", "Data", "Manifests");
            string[] items;
            try { items = Directory.GetFiles(manifests, "*.item"); } catch { items = new string[0]; }
            foreach (var f in items)
            {
                string txt;
                try { txt = File.ReadAllText(f); } catch { continue; }
                var m = Regex.Match(txt, "\"InstallLocation\"\\s*:\\s*\"([^\"]+)\"");
                if (!m.Success) continue;
                string loc = m.Groups[1].Value.Replace("\\\\", "\\");
                if (Regex.IsMatch(txt + loc, "kingdom\\s*hearts|KH_1\\.5|KH_2\\.8", RegexOptions.IgnoreCase))
                    yield return loc;
            }
            foreach (var d in DriveLetters())
                foreach (var b in new[] { @"Program Files\Epic Games", "Epic Games", @"Games\Epic Games" })
                    foreach (var n in DirNames)
                        yield return Path.Combine(d, b, n);
        }

        // ---------------------------------------------------------- пошук

        // Linux розрізняє регістр, а «Image» у різних встановленнях писали
        // по-різному. Шукаємо підтеку, не зважаючи на регістр.
        static string Sub(string parent, string name)
        {
            string exact = Path.Combine(parent, name);
            if (Dir(exact)) return exact;
            if (IsWin || !Dir(parent)) return exact;
            foreach (var d in SafeDirs(parent))
                if (string.Equals(Path.GetFileName(d), name, StringComparison.OrdinalIgnoreCase)) return d;
            return exact;
        }

        // Тека Image/<dt|en> усередині `root`, якщо в ній є хоч один із потрібних .pkg.
        public static GameInstall Inspect(string root, string[] pkgNames, string source)
        {
            if (!Dir(root)) return null;
            // Вказати могли і корінь збірки, і сам Image, і вже Image/dt.
            var bases = new List<string> { Sub(root, "Image"), root };
            foreach (var b in bases)
            {
                foreach (var sub in ImageSubs)
                {
                    string img = Sub(b, sub);
                    var hit = PkgsIn(img, pkgNames);
                    if (hit.Length > 0) return new GameInstall { Root = root, ImageDir = img, Source = source, Found = hit };
                }
            }
            var direct = PkgsIn(root, pkgNames);
            if (direct.Length > 0) return new GameInstall { Root = root, ImageDir = root, Source = source, Found = direct };
            return null;
        }

        static string[] PkgsIn(string dir, string[] pkgNames)
        {
            if (!Dir(dir)) return new string[0];
            var found = new List<string>();
            foreach (var n in pkgNames)
                if (File.Exists(Path.Combine(dir, n + ".pkg")) && File.Exists(Path.Combine(dir, n + ".hed")))
                    found.Add(n);
            return found.ToArray();
        }

        // Усі знайдені встановлення для заданого набору .pkg (без повторів).
        public static List<GameInstall> FindAll(string[] pkgNames)
        {
            var outp = new List<GameInstall>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Try(string dir, string src)
            {
                var g = Inspect(dir, pkgNames, src);
                if (g == null) return;
                if (!seen.Add(Path.GetFullPath(g.ImageDir).TrimEnd(Path.DirectorySeparatorChar))) return;
                outp.Add(g);
            }
            foreach (var d in SteamGameDirs()) Try(d, "Steam");
            foreach (var d in EpicGameDirs()) Try(d, "Epic Games");
            return outp;
        }
    }
}
