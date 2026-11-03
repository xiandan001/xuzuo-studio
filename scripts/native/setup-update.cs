using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading;

namespace Xuzuo.Setup
{
    internal static class SetupUpdate
    {
        private static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        public static int Run(SetupEngine engine, string[] args)
        {
            string result = null;
            try
            {
                var options = Options(args);
                result = ResultPath(engine.Metadata, options["--result"]);
                if (!engine.HasPayload) throw new InvalidDataException("自动更新需要完整安装包。");
                var root = Path.GetFullPath(options["--root"]);
                engine.ValidateRegisteredRoot(root);
                int pid; double startedAt;
                if (!Int32.TryParse(options["--wait-pid"], NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid <= 0 || pid == Process.GetCurrentProcess().Id || !Double.TryParse(options["--wait-start"], NumberStyles.Float, CultureInfo.InvariantCulture, out startedAt) || Double.IsNaN(startedAt) || Double.IsInfinity(startedAt) || startedAt <= 0) throw new InvalidDataException("更新等待进程身份无效。");
                using (var mutex = new Mutex(false, "Local\\Xuzuo.Setup." + engine.Metadata.installGuid))
                {
                    bool owned;
                    try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
                    if (!owned) throw new IOException("另一项安装或维护操作正在进行，请下次退出时重试。");
                    try
                    {
                        WaitForApplication(root, engine.Metadata.executable, pid, startedAt);
                        engine.ValidateRegisteredRoot(root);
                        var installed = engine.Install(root, false);
                        WriteResult(result, engine.Metadata.version, true, installed.Detail);
                        return 0;
                    }
                    finally { mutex.ReleaseMutex(); }
                }
            }
            catch (Exception error)
            {
                if (result != null)
                {
                    try { WriteResult(result, engine.Metadata.version, false, error.Message); }
                    catch { /* A failed result write must not open UI or change the installation. */ }
                }
                return 1;
            }
        }

        private static Dictionary<string, string> Options(string[] args)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            var update = false;
            for (var index = 0; index < args.Length; index++)
            {
                var name = args[index];
                if (name == "--update") { if (update) throw new InvalidDataException("更新参数重复。"); update = true; continue; }
                if (name != "--root" && name != "--wait-pid" && name != "--wait-start" && name != "--result" || result.ContainsKey(name) || index + 1 >= args.Length || String.IsNullOrWhiteSpace(args[index + 1]) || args[index + 1].StartsWith("--", StringComparison.Ordinal)) throw new InvalidDataException("更新启动参数不完整或无效。");
                result.Add(name, args[++index]);
            }
            if (!update || result.Count != 4) throw new InvalidDataException("更新启动参数不完整。");
            return result;
        }

        private static string ResultPath(SetupMetadata metadata, string value)
        {
            var state = metadata.validation ? Path.GetFullPath(metadata.validationRoot) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "xuzuo-studio");
            NoLinks(state);
            if (metadata.validation)
            {
                var marker = SetupJson.File<Dictionary<string, object>>(Path.Combine(state, ".xuzuo-setup-validation.json"));
                if (Convert.ToInt32(marker["format"]) != 1 || Convert.ToString(marker["kind"]) != "xuzuo-setup-validation" || Convert.ToString(marker["appId"]) != metadata.appId || !String.Equals(Convert.ToString(marker["installGuid"]), metadata.installGuid, StringComparison.OrdinalIgnoreCase) || !Same(Convert.ToString(marker["root"]), state)) throw new InvalidDataException("更新验证目录身份无效。");
            }
            var expected = Path.Combine(state, "updates", "result.json");
            if (!Same(value, expected)) throw new InvalidDataException("更新结果路径不属于当前应用。");
            NoLinks(expected);
            return expected;
        }

        private static bool Same(string left, string right) { return String.Equals(Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase); }

        private static void NoLinks(string value)
        {
            var full = Path.GetFullPath(value); var root = Path.GetPathRoot(full); var current = root;
            foreach (var part in full.Substring(root.Length).Split(new[] { Path.DirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
            {
                current = Path.Combine(current, part);
                FileAttributes attributes;
                try { attributes = File.GetAttributes(current); } catch (FileNotFoundException) { break; } catch (DirectoryNotFoundException) { break; }
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("更新结果路径包含链接。");
            }
        }

        private static void WaitForApplication(string root, string executable, int pid, double startedAt)
        {
            Process parent;
            try { parent = Process.GetProcessById(pid); } catch (ArgumentException) { return; }
            using (parent)
            {
                try
                {
                    if (parent.HasExited) return;
                    if (parent.Handle == IntPtr.Zero) throw new IOException("无法等待原应用进程。");
                    if (parent.HasExited) return;
                    if (!Same(parent.MainModule.FileName, Path.Combine(root, executable)) || Math.Abs((parent.StartTime.ToUniversalTime() - Epoch).TotalMilliseconds - startedAt) > 2) throw new InvalidDataException("等待的进程与原应用不一致，更新已停止。");
                    if (!parent.WaitForExit(120000)) throw new IOException("应用仍在退出，请下次正常退出时重试更新。");
                }
                catch (InvalidOperationException) { if (!parent.HasExited) throw; }
                catch (Win32Exception) { if (!parent.HasExited) throw; }
            }
        }

        private static void WriteResult(string file, string version, bool success, string detail)
        {
            NoLinks(file);
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            NoLinks(file);
            SetupJson.Write(file, new { version = version, success = success, detail = (detail ?? "").Length > 2000 ? detail.Substring(0, 2000) : detail, at = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) });
        }
    }
}
