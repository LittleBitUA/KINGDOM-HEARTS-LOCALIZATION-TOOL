using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Ionic.Zip;

namespace KhUa
{
    // Застосування .pcpatch кодом KHPCPatchManager, але всередині нашого
    // процесу: без перетягування файлів у вікно й без відповідей у консолі.
    //
    // Одна суттєва відмінність від апстріму. Там перед патчем живий .pkg
    // ПЕРЕНОСЯТЬ у backup/, затираючи те, що там лежало. Пропатчиш двічі —
    // і в резервній копії вже не оригінал, а результат першого патчу, тобто
    // відкотитись назад нічим. Ми навпаки: якщо резервна копія вже є, вона
    // недоторканна й служить джерелом. Тому повторне застосування завжди
    // рахується від чистої гри, і патчі різних версій не нашаровуються.
    public static class PatchApplier
    {
        public static readonly Dictionary<string, string[]> KhFiles = new Dictionary<string, string[]>
        {
            { "KH1", new[]{ "kh1_first", "kh1_second", "kh1_third", "kh1_fourth", "kh1_fifth" } },
            { "KH2", new[]{ "kh2_first", "kh2_second", "kh2_third", "kh2_fourth", "kh2_fifth", "kh2_sixth" } },
            { "COM", new[]{ "Recom" } },
            { "BBS", new[]{ "bbs_first", "bbs_second", "bbs_third", "bbs_fourth" } },
            { "DDD", new[]{ "kh3d_first", "kh3d_second", "kh3d_third", "kh3d_fourth" } }
        };

        public static readonly Dictionary<string, string> ExtType = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".kh1pcpatch", "KH1" },
            { ".kh2pcpatch", "KH2" },
            { ".compcpatch", "COM" },
            { ".bbspcpatch", "BBS" },
            { ".dddpcpatch", "DDD" }
        };

        public static readonly Dictionary<string, string> TypeName = new Dictionary<string, string>
        {
            { "KH1", "KINGDOM HEARTS FINAL MIX" },
            { "KH2", "KINGDOM HEARTS II FINAL MIX" },
            { "COM", "KINGDOM HEARTS Re:Chain of Memories" },
            { "BBS", "KINGDOM HEARTS Birth by Sleep FINAL MIX" },
            { "DDD", "KINGDOM HEARTS Dream Drop Distance" }
        };

        public static string TypeOf(string patchFile)
        {
            string t;
            return ExtType.TryGetValue(Path.GetExtension(patchFile), out t) ? t : null;
        }

        public sealed class Result
        {
            public List<string> Patched = new List<string>();
            public List<string> Skipped = new List<string>();
            public List<string> Failed = new List<string>();
        }

        // Які .pkg цього типу справді зачіпає набір патчів.
        public static List<string> Targets(string type, List<ZipFile> zips)
        {
            var outp = new List<string>();
            foreach (var name in KhFiles[type])
            {
                string prefix = name + "/";
                bool hit = zips.Any(z => z.EntryFileNames.Any(n =>
                    n.Replace('\\', '/').TrimStart('/').StartsWith(prefix, StringComparison.OrdinalIgnoreCase)));
                if (hit) outp.Add(name);
            }
            return outp;
        }

        public static Result Apply(string imageDir, IList<string> patchFiles, string type,
                                   bool keepBackup, Action<string> say, Action<string> progress)
        {
            var res = new Result();
            var zips = new List<ZipFile>();
            try
            {
                // Пізніший файл у списку має перекривати ранішій — саме тому Insert(0).
                foreach (var f in patchFiles) zips.Insert(0, ZipFile.Read(f));
                KHPCPatchManager.ZipFiles = zips;

                var targets = Targets(type, zips);
                if (targets.Count == 0)
                    throw new InvalidOperationException("у патчі немає жодної теки з файлами цієї гри");

                string backupDir = Path.Combine(imageDir, "backup");
                Directory.CreateDirectory(backupDir);

                foreach (var name in targets)
                {
                    string live = Path.Combine(imageDir, name + ".pkg");
                    string liveHed = Path.Combine(imageDir, name + ".hed");
                    string bak = Path.Combine(backupDir, name + ".pkg");
                    string bakHed = Path.Combine(backupDir, name + ".hed");

                    if (!File.Exists(live) || !File.Exists(liveHed))
                    {
                        res.Skipped.Add(name + " (немає у грі)");
                        continue;
                    }

                    bool haveBackup = File.Exists(bak) && File.Exists(bakHed);
                    if (haveBackup)
                    {
                        say("  " + name + ": беремо чистий файл із резервної копії");
                    }
                    else
                    {
                        say("  " + name + ": відкладаємо оригінал у backup/");
                        File.Move(live, bak);
                        File.Move(liveHed, bakHed);
                    }

                    var bgw = new MyBackgroundWorker { WorkerReportsProgress = true, PKG = name };
                    bgw.ProgressChanged += (s, e) => progress((string)e.UserState);
                    try
                    {
                        OpenKh.Egs.EgsTools.Patch(bak, name, imageDir, bgw);
                        res.Patched.Add(name);
                    }
                    catch (Exception ex)
                    {
                        // Патч не дописався — повертаємо гру в робочий стан.
                        try
                        {
                            if (!File.Exists(live) && File.Exists(bak)) File.Copy(bak, live, true);
                            if (!File.Exists(liveHed) && File.Exists(bakHed)) File.Copy(bakHed, liveHed, true);
                        }
                        catch { }
                        res.Failed.Add(name + ": " + ex.Message);
                    }
                }

                if (!keepBackup)
                {
                    foreach (var name in res.Patched)
                    {
                        try
                        {
                            File.Delete(Path.Combine(backupDir, name + ".pkg"));
                            File.Delete(Path.Combine(backupDir, name + ".hed"));
                        }
                        catch { }
                    }
                }
            }
            finally
            {
                foreach (var z in zips) { try { z.Dispose(); } catch { } }
                KHPCPatchManager.ZipFiles = new List<ZipFile>();
            }
            return res;
        }

        // Відкат: повертаємо в гру те, що лежить у backup/.
        public static Result Restore(string imageDir, string type, Action<string> say)
        {
            var res = new Result();
            string backupDir = Path.Combine(imageDir, "backup");
            if (!Directory.Exists(backupDir))
                throw new InvalidOperationException("резервної копії немає: " + backupDir);

            foreach (var name in KhFiles[type])
            {
                string bak = Path.Combine(backupDir, name + ".pkg");
                string bakHed = Path.Combine(backupDir, name + ".hed");
                if (!File.Exists(bak) || !File.Exists(bakHed)) continue;
                try
                {
                    say("  " + name + ": повертаємо оригінал");
                    File.Copy(bak, Path.Combine(imageDir, name + ".pkg"), true);
                    File.Copy(bakHed, Path.Combine(imageDir, name + ".hed"), true);
                    res.Patched.Add(name);
                }
                catch (Exception ex) { res.Failed.Add(name + ": " + ex.Message); }
            }
            if (res.Patched.Count == 0 && res.Failed.Count == 0)
                throw new InvalidOperationException("у backup/ немає файлів цієї гри");
            return res;
        }
    }
}
