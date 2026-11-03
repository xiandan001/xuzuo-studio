using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

namespace Xuzuo.Setup
{
    public sealed class SetupEngine
    {
        public const string ReceiptPath = "resources/xuzuo-install-manifest.json";
        public const string MaintenancePath = "resources/xuzuo-maintenance.exe";
        private const string OwnerFile = ".xuzuo-setup-owner.json";
        private const string OperationFile = ".xuzuo-setup-operation.json";
        private readonly SetupMetadata metadata;
        private readonly string stateDirectory;
        private readonly string journalPath;
        private readonly string installKey;
        private long lastProgress;
        public Action<string, string, double?> Progress;

        [DllImport("kernel32.dll")] private static extern uint GetLogicalDrives();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint QueryDosDevice(string name, StringBuilder target, int length);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern uint GetDriveType(string root);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetLongPathName(string path, StringBuilder output, uint length);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateDirectory(string path, IntPtr attributes);

        public SetupEngine(SetupMetadata value)
        {
            metadata = value; ValidateMetadata(value);
            installKey = "Software\\" + metadata.installGuid;
            if (metadata.validation)
            {
                ValidateValidationRoot();
                stateDirectory = Path.Combine(Full(metadata.validationRoot), "setup-state", metadata.installGuid);
            }
            else stateDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XuzuoStudio.Setup", metadata.installGuid);
            NoReparse(stateDirectory);
            journalPath = Path.Combine(stateDirectory, "transaction.json");
        }
        public SetupMetadata Metadata { get { return metadata; } }
        public bool HasPayload { get { return Assembly.GetExecutingAssembly().GetManifestResourceInfo("Setup.Payload.zip") != null; } }
        public string DefaultDirectory
        {
            get
            {
                var existing = ReadRegistration();
                if (existing != null && !String.IsNullOrEmpty(existing.Root)) return existing.Root;
                NoReparse(journalPath);
                if (File.Exists(journalPath)) { var journal = SetupJson.File<SetupJournal>(journalPath); if (HasRecoverableOperation(journal.root)) return journal.root; }
                return metadata.validation ? Path.Combine(Full(metadata.validationRoot), "installed", metadata.defaultDirectoryName) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", metadata.defaultDirectoryName);
            }
        }
        private static bool Same(string left, string right) { return String.Equals(Full(left), Full(right), StringComparison.OrdinalIgnoreCase); }
        private static bool Inside(string root, string value) { return Same(root, value) || Full(value).StartsWith(Full(root).TrimEnd('\\') + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
        private static string Full(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length > 220 || !Regex.IsMatch(value, "^[A-Za-z]:[\\\\/]")) throw new InvalidDataException("请选择较短的本地绝对路径。");
            if (value.IndexOfAny(new[] { '\0', '\r', '\n', '"' }) >= 0 || value.Substring(2).Contains(":")) throw new InvalidDataException("目录路径包含不支持的字符。");
            var full = Path.GetFullPath(value.Replace('/', '\\')); var cursor = full; var suffix = new Stack<string>();
            while (!Directory.Exists(cursor) && !File.Exists(cursor)) { var parent = Path.GetDirectoryName(cursor); if (String.IsNullOrEmpty(parent) || parent == cursor) break; suffix.Push(Path.GetFileName(cursor)); cursor = parent; }
            var expanded = new StringBuilder(32768); var size = GetLongPathName(cursor, expanded, (uint)expanded.Capacity);
            if (size == 0 || size >= expanded.Capacity) throw new InvalidDataException("目录路径无法安全核验，请检查权限或磁盘连接。");
            full = expanded.ToString(); while (suffix.Count > 0) full = Path.Combine(full, suffix.Pop());
            return full.Length <= 3 ? full : full.TrimEnd('\\');
        }
        private static string Relative(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 220 || value.Contains("\\") || value.StartsWith("/")) throw new InvalidDataException("安装清单路径无效。");
            foreach (var name in value.Split('/')) ValidateName(name);
            return value;
        }
        private static void ValidateName(string name)
        {
            if (String.IsNullOrEmpty(name) || name.Length > 150 || name != name.Trim() || Regex.IsMatch(name, "[<>:\"/\\\\|?*\\x00-\\x1f]") || name.EndsWith(".") || name.EndsWith(" ") || Regex.IsMatch(name, "^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)", RegexOptions.IgnoreCase)) throw new InvalidDataException("名称不能包含路径、保留设备名或特殊字符。");
        }
        private static void ValidateMetadata(SetupMetadata value)
        {
            Guid guid;
            if (value == null || !Regex.IsMatch(value.appId ?? "", "^[a-zA-Z0-9.-]{3,160}$") || !Guid.TryParse(value.installGuid, out guid) || String.IsNullOrWhiteSpace(value.version) || String.IsNullOrWhiteSpace(value.productName)) throw new InvalidDataException("安装元数据不完整。");
            value.installGuid = guid.ToString("D");
            if (value.validation && (value.appId == "local.xuzuo.studio" || value.installGuid.Equals("a9b872cb-e912-55bd-995c-2b5475233511", StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("验证构建不能使用正式产品的登记标识。");
            ValidateName(value.executable); ValidateName(value.defaultDirectoryName ?? "xuzuo-studio"); ValidateName(value.shortcutName ?? value.productName);
            if (value.defaultDirectoryName == null) value.defaultDirectoryName = "xuzuo-studio";
            if (value.shortcutName == null) value.shortcutName = value.productName;
            var expected = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + value.installGuid;
            if (String.IsNullOrEmpty(value.uninstallRegistryKey)) value.uninstallRegistryKey = expected;
            if (!String.Equals(value.uninstallRegistryKey, expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("卸载登记标识与产品不一致。");
            if (value.legacyFiles != null)
            {
                if (value.legacyFiles.Count > 100) throw new InvalidDataException("旧版受管清单超过限制。");
                foreach (var file in value.legacyFiles) if (String.IsNullOrEmpty(Relative(file.path)) || file.bytes < 0 || !Regex.IsMatch(file.sha256 ?? "", "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("旧版受管文件清单无效。");
            }
        }
        public SetupManifest ReadPayloadManifest()
        {
            var manifest = SetupJson.Resource<SetupManifest>("Setup.Manifest.json"); ValidateManifest(manifest, metadata.version); return manifest;
        }
        public void ValidateManifest(SetupManifest manifest, string expectedVersion)
        {
            if (manifest == null || manifest.format != 1 || manifest.appId != metadata.appId || manifest.executable != metadata.executable || String.IsNullOrWhiteSpace(manifest.version) || expectedVersion != null && manifest.version != expectedVersion || manifest.files == null || manifest.files.Count == 0 || manifest.files.Count > 20000) throw new InvalidDataException("安装清单身份或版本不匹配。");
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
            foreach (var file in manifest.files)
            {
                Relative(file.path);
                if (file.path.Equals(ReceiptPath, StringComparison.OrdinalIgnoreCase) || file.path.Equals(OwnerFile, StringComparison.OrdinalIgnoreCase) || file.path.Equals(OperationFile, StringComparison.OrdinalIgnoreCase) || !names.Add(file.path) || file.bytes < 0 || file.bytes > 536870912 || !Regex.IsMatch(file.sha256 ?? "", "^[a-fA-F0-9]{64}$")) throw new InvalidDataException("安装清单包含重复、保留或过大的文件。");
                total = checked(total + file.bytes);
                if (total > 2147483648L) throw new InvalidDataException("安装内容超过容量限制。");
            }
            if (!names.Contains(metadata.executable) || !names.Contains(MaintenancePath)) throw new InvalidDataException("安装包缺少应用或维护入口。");
            foreach (var name in names) { var parent = name; while (parent.Contains("/")) { parent = parent.Substring(0, parent.LastIndexOf('/')); if (names.Contains(parent)) throw new InvalidDataException("安装文件与目录路径冲突。"); } }
        }
        private static void NoReparse(string value)
        {
            var full = Full(value); var root = Path.GetPathRoot(full); var current = root;
            foreach (var name in full.Substring(root.Length).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
            {
                current = Path.Combine(current, name);
                FileAttributes attributes;
                try { attributes = File.GetAttributes(current); } catch (FileNotFoundException) { break; } catch (DirectoryNotFoundException) { break; }
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("目录包含链接或重解析点，请选择普通本地目录。");
            }
        }
        private void ValidateValidationRoot()
        {
            var root = Full(metadata.validationRoot); NoReparse(root);
            var marker = SetupJson.File<Dictionary<string, object>>(Path.Combine(root, ".xuzuo-setup-validation.json"));
            if (Convert.ToInt32(marker["format"]) != 1 || Convert.ToString(marker["kind"]) != "xuzuo-setup-validation" || Convert.ToString(marker["appId"]) != metadata.appId || !String.Equals(Convert.ToString(marker["installGuid"]), metadata.installGuid, StringComparison.OrdinalIgnoreCase) || !Same(Convert.ToString(marker["root"]), root)) throw new InvalidDataException("独立验证目录标记无效。");
            if (String.IsNullOrEmpty(metadata.shortcutRoot) || !Inside(root, metadata.shortcutRoot) || Same(root, metadata.shortcutRoot)) throw new InvalidDataException("验证快捷方式必须保存在验证目录内。");
        }
        private static bool LocalDrive(string path)
        {
            var root = Path.GetPathRoot(Full(path)); var device = new StringBuilder(32768);
            if (QueryDosDevice(root.Substring(0, 2), device, device.Capacity) == 0) return false;
            var name = device.ToString();
            if (name.IndexOf("LanmanRedirector", StringComparison.OrdinalIgnoreCase) >= 0 || name.IndexOf("WebDav", StringComparison.OrdinalIgnoreCase) >= 0 || name.StartsWith("\\Device\\Mup", StringComparison.OrdinalIgnoreCase) || name.StartsWith("\\??\\", StringComparison.OrdinalIgnoreCase)) return false;
            var type = GetDriveType(root); return type == 2 || type == 3;
        }
        private void SafeRoot(string value)
        {
            var root = Full(value); NoReparse(root);
            if (!LocalDrive(root) || root.Length < 4 || root.Length > 180) throw new InvalidDataException("请选择可用的本地独立安装文件夹，路径不要过长。");
            if (metadata.validation) { ValidateValidationRoot(); if (!Inside(metadata.validationRoot, root) || Same(metadata.validationRoot, root)) throw new InvalidDataException("验证安装目录必须在本次独立验证目录内。"); }
            var critical = new[] { Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.System), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Path.GetTempPath().TrimEnd('\\'), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs") };
            foreach (var item in critical) if (!String.IsNullOrEmpty(item) && Inside(root, item)) throw new InvalidDataException("不能使用系统目录、个人资料目录或它们的上级作为安装文件夹。");
            foreach (var item in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.System), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }) if (!String.IsNullOrEmpty(item) && Inside(item, root)) throw new InvalidDataException("请选择个人可写入的安装目录，不使用系统或整机程序目录。");
            if (Same(root, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"))) throw new InvalidDataException("请选择下载目录内的独立子文件夹，不直接使用整个下载目录。");
            var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "xuzuo-studio");
            if (Inside(root, userData) || Inside(userData, root)) throw new InvalidDataException("安装目录不能包含应用资料或密钥目录。");
            var cursor = root;
            while (cursor.Length > 3)
            {
                if (File.Exists(Path.Combine(cursor, ".xuzuo-workspace-v1.json")) || Directory.Exists(Path.Combine(cursor, ".xuzuo"))) throw new InvalidDataException("此位置属于创作工作区，请另选独立的应用安装文件夹。");
                var parent = Path.GetDirectoryName(cursor); if (String.IsNullOrEmpty(parent) || parent == cursor) break; cursor = parent;
            }
            if (File.Exists(root)) throw new InvalidDataException("安装位置是文件，请选择独立文件夹。");
        }
        private static string At(string root, string relative)
        {
            Relative(relative); var target = Full(Path.Combine(root, relative.Replace('/', '\\')));
            if (!Inside(root, target) || Same(root, target)) throw new InvalidDataException("文件路径超出安装目录。");
            NoReparse(target); return target;
        }
        private static string Sha(string path)
        {
            using (var file = File.OpenRead(path)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
        }
        private static RegistryKey Hive(RegistryHive hive) { return RegistryKey.OpenBaseKey(hive, RegistryView.Registry64); }
        public SetupRegistration ReadRegistration()
        {
            using (var current = Hive(RegistryHive.CurrentUser))
            using (var key = current.OpenSubKey(metadata.uninstallRegistryKey))
            using (var legacy = current.OpenSubKey(installKey))
            {
                var ownId = legacy == null ? "" : Convert.ToString(legacy.GetValue("AppId", ""));
                var arpId = key == null ? "" : Convert.ToString(key.GetValue("AppId", ""));
                if (!String.IsNullOrEmpty(ownId) && ownId != metadata.appId || !String.IsNullOrEmpty(arpId) && arpId != metadata.appId) throw new InvalidDataException("安装登记属于其它产品，未修改任何文件。");
                var root = legacy == null ? null : Convert.ToString(legacy.GetValue("InstallLocation", ""));
                var arpRoot = key == null ? null : Convert.ToString(key.GetValue("InstallLocation", ""));
                if (!String.IsNullOrEmpty(root) && !String.IsNullOrEmpty(arpRoot) && !Same(root, arpRoot)) throw new InvalidDataException("应用安装登记存在冲突，未修改现有文件。");
                if (String.IsNullOrEmpty(root)) root = arpRoot;
                if (!String.IsNullOrEmpty(root)) return new SetupRegistration { Root = Full(root), Version = key == null ? "" : Convert.ToString(key.GetValue("DisplayVersion", "")), LegacyUninstaller = UninstallExecutable(key == null ? "" : Convert.ToString(key.GetValue("UninstallString", ""))), Machine = false };
            }
            using (var machine = Hive(RegistryHive.LocalMachine))
            using (var key = machine.OpenSubKey(metadata.uninstallRegistryKey))
            {
                if (key != null) return new SetupRegistration { Root = Convert.ToString(key.GetValue("InstallLocation", "")), Version = Convert.ToString(key.GetValue("DisplayVersion", "")), Machine = true };
            }
            return null;
        }
        private static string UninstallExecutable(string command)
        {
            if (String.IsNullOrEmpty(command)) return null;
            var match = Regex.Match(command, "^\"([^\"]+\\.exe)\"", RegexOptions.IgnoreCase);
            return match.Success && Path.GetFileName(match.Groups[1].Value).StartsWith("Uninstall", StringComparison.OrdinalIgnoreCase) ? match.Groups[1].Value : null;
        }
        private SetupManifest InstalledManifest(string root)
        {
            var file = At(root, ReceiptPath); if (!File.Exists(file)) return null;
            var manifest = SetupJson.File<SetupManifest>(file); ValidateManifest(manifest, null); return manifest;
        }
        public void ValidateRegisteredRoot(string root)
        {
            SafeRoot(root); var registration = ReadRegistration();
            if (registration == null || registration.Machine || !Same(root, registration.Root)) throw new InvalidDataException("此目录不是当前用户登记的应用安装位置。");
            var manifest = InstalledManifest(root);
            var executable = At(root, metadata.executable);
            if (!File.Exists(executable) || !String.Equals(FileVersionInfo.GetVersionInfo(executable).ProductName, metadata.executableProductName ?? metadata.productName, StringComparison.Ordinal)) throw new InvalidDataException("应用文件身份无法核验，未修改此目录。");
            if (manifest != null)
            {
                var maintenance = manifest.files.First(file => file.path.Equals(MaintenancePath, StringComparison.OrdinalIgnoreCase));
                var current = At(root, MaintenancePath);
                if (!File.Exists(current) || !String.Equals(Sha(current), maintenance.sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("维护程序与安装清单不一致，请重新安装修复。");
            }
        }
        private void Report(string stage, string detail, double? percent, bool force = false)
        {
            var now = Stopwatch.GetTimestamp();
            if (!force && now - lastProgress < Stopwatch.Frequency / 10) return; lastProgress = now;
            if (Progress != null) Progress(stage, detail, percent);
        }
        private void CloseApplication(string root)
        {
            Report("等待应用退出", "请在应用内处理未保存内容；安装器不会强制结束应用。", null, true);
            var deadline = DateTime.UtcNow.AddSeconds(20); var requested = new HashSet<int>();
            while (true)
            {
                var running = new List<Process>();
                foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(metadata.executable)))
                {
                    try { if (!process.HasExited && Same(process.MainModule.FileName, At(root, metadata.executable))) running.Add(process); else process.Dispose(); }
                    catch { var exited = false; try { exited = process.HasExited; } catch { } process.Dispose(); if (!exited && !metadata.validation) throw new IOException("发现同名应用进程但无法核验其位置，请先关闭应用后重试。没有强制结束任何进程。"); }
                }
                if (running.Count == 0) return;
                foreach (var process in running) { try { if (requested.Add(process.Id)) process.CloseMainWindow(); } catch { } finally { process.Dispose(); } }
                if (DateTime.UtcNow >= deadline) throw new IOException("应用仍在运行或等待保存，请返回应用处理后点击重试。没有强制结束任何进程。");
                Thread.Sleep(120);
            }
        }
        private void RejectOtherRunningCopies(string root)
        {
            if (metadata.validation) return;
            foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(metadata.executable)))
            {
                try
                {
                    if (process.HasExited) continue;
                    string path;
                    try { path = process.MainModule.FileName; } catch { if (process.HasExited) continue; throw new IOException("发现同名应用进程但无法核验目录，请先退出应用后重试。没有强制关闭任何进程。"); }
                    if (!Same(path, At(root, metadata.executable)) && String.Equals(FileVersionInfo.GetVersionInfo(path).ProductName, metadata.executableProductName ?? metadata.productName, StringComparison.Ordinal)) throw new IOException("另一个目录中的应用仍在运行，请先退出该版本再重试：" + Path.GetDirectoryName(path));
                }
                finally { process.Dispose(); }
            }
        }
        private SetupRegistrySnapshot Snapshot(string path)
        {
            using (var hive = Hive(RegistryHive.CurrentUser)) using (var key = hive.OpenSubKey(path))
            {
                return new SetupRegistrySnapshot { Exists = key != null, Values = key == null ? new List<SetupRegistryValue>() : key.GetValueNames().Select(name => new SetupRegistryValue { Name = name, Kind = key.GetValueKind(name).ToString(), Value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) }).ToList() };
            }
        }
        private void RestoreRegistry(string path, SetupRegistrySnapshot snapshot)
        {
            using (var hive = Hive(RegistryHive.CurrentUser))
            {
                if (!snapshot.Exists) { hive.DeleteSubKeyTree(path, false); return; }
                using (var key = hive.CreateSubKey(path))
                {
                    foreach (var name in key.GetValueNames()) key.DeleteValue(name, false);
                    foreach (var item in snapshot.Values)
                    {
                        var kind = (RegistryValueKind)Enum.Parse(typeof(RegistryValueKind), item.Kind); object value = item.Value;
                        if (kind == RegistryValueKind.DWord) value = Convert.ToInt32(value);
                        else if (kind == RegistryValueKind.QWord) value = Convert.ToInt64(value);
                        else if (kind == RegistryValueKind.Binary) value = ((System.Collections.IEnumerable)value).Cast<object>().Select(Convert.ToByte).ToArray();
                        else if (kind == RegistryValueKind.MultiString) value = ((System.Collections.IEnumerable)value).Cast<object>().Select(Convert.ToString).ToArray();
                        key.SetValue(item.Name, value, kind);
                    }
                }
            }
        }
        private string ShortcutFile(bool desktop)
        {
            var directory = metadata.validation ? Path.Combine(Full(metadata.shortcutRoot), desktop ? "Desktop" : "StartMenu") : Environment.GetFolderPath(desktop ? Environment.SpecialFolder.DesktopDirectory : Environment.SpecialFolder.Programs);
            if (metadata.validation && (!Inside(metadata.validationRoot, directory) || Same(metadata.validationRoot, directory))) throw new InvalidDataException("验证快捷方式越界。");
            NoReparse(directory); return Path.Combine(directory, metadata.shortcutName + ".lnk");
        }
        private Dictionary<string, string> SnapshotShortcuts()
        {
            var result = new Dictionary<string, string>();
            foreach (var file in new[] { ShortcutFile(true), ShortcutFile(false) }) { NoReparse(file); if (File.Exists(file) && new FileInfo(file).Length > 1048576) throw new IOException("同名快捷方式内容异常，未替换该文件。"); result[file] = File.Exists(file) ? Convert.ToBase64String(File.ReadAllBytes(file)) : null; }
            return result;
        }
        private void RestoreShortcuts(Dictionary<string, string> values)
        {
            foreach (var item in values) { if (!Same(item.Key, ShortcutFile(true)) && !Same(item.Key, ShortcutFile(false))) throw new InvalidDataException("快捷方式恢复路径越界。"); if (item.Value == null) { if (File.Exists(item.Key)) File.Delete(item.Key); } else { Directory.CreateDirectory(Path.GetDirectoryName(item.Key)); File.WriteAllBytes(item.Key, Convert.FromBase64String(item.Value)); } }
        }
        private bool ShortcutOwned(string path, string root)
        {
            NoReparse(path);
            if (!File.Exists(path)) return true; object shell = null, shortcut = null;
            try { shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")); shortcut = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path }); var target = Convert.ToString(shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null)); return !String.IsNullOrEmpty(target) && Same(target, At(root, metadata.executable)); }
            finally { if (shortcut != null) Marshal.FinalReleaseComObject(shortcut); if (shell != null) Marshal.FinalReleaseComObject(shell); }
        }
        private void WriteShortcut(string path, string executable, string root)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)); object shell = null, shortcut = null;
            try
            {
                shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                shortcut = shell.GetType().InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { path });
                var type = shortcut.GetType();
                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { executable });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { root });
                type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { metadata.productName });
                type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            finally { if (shortcut != null) Marshal.FinalReleaseComObject(shortcut); if (shell != null) Marshal.FinalReleaseComObject(shell); }
        }
        private void Register(string root, bool desktop, SetupManifest manifest)
        {
            using (var hive = Hive(RegistryHive.CurrentUser))
            using (var own = hive.CreateSubKey(installKey))
            using (var arp = hive.CreateSubKey(metadata.uninstallRegistryKey))
            {
                own.SetValue("InstallLocation", root); own.SetValue("AppId", metadata.appId);
                arp.SetValue("DisplayName", metadata.productName); arp.SetValue("DisplayVersion", metadata.version); arp.SetValue("Publisher", metadata.productName); arp.SetValue("InstallLocation", root);
                arp.SetValue("AppId", metadata.appId);
                arp.SetValue("DisplayIcon", At(root, metadata.executable) + ",0");
                arp.SetValue("UninstallString", Quote(At(root, MaintenancePath)) + " --uninstall --root " + Quote(root));
                arp.DeleteValue("QuietUninstallString", false); arp.SetValue("NoModify", 1, RegistryValueKind.DWord); arp.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                arp.SetValue("EstimatedSize", (int)Math.Min(Int32.MaxValue, manifest.files.Sum(file => file.bytes) / 1024), RegistryValueKind.DWord);
            }
            WriteShortcut(ShortcutFile(false), At(root, metadata.executable), root);
            if (desktop) WriteShortcut(ShortcutFile(true), At(root, metadata.executable), root);
        }
        public static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
        private void SaveJournal(SetupJournal journal) { NoReparse(stateDirectory); Directory.CreateDirectory(stateDirectory); NoReparse(journalPath); SetupJson.Write(journalPath, journal); }
        private void PrepareOwnedDirectory(string root, string nonce, string marker)
        {
            NoReparse(Path.GetDirectoryName(root));
            if (!CreateDirectory(root, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error(), "暂存目录未能独立创建，请重试。");
            try { SetupJson.Write(Path.Combine(root, marker), new { format = 1, appId = metadata.appId, installGuid = metadata.installGuid, nonce = nonce }); }
            catch { if (Directory.Exists(root) && !Directory.EnumerateFileSystemEntries(root).Any()) Directory.Delete(root); throw; }
        }
        private void ValidateOwner(string root, string nonce, string name)
        {
            NoReparse(root); var owner = SetupJson.File<Dictionary<string, object>>(Path.Combine(root, name));
            if (Convert.ToInt32(owner["format"]) != 1 || Convert.ToString(owner["appId"]) != metadata.appId || Convert.ToString(owner["installGuid"]) != metadata.installGuid || Convert.ToString(owner["nonce"]) != nonce) throw new InvalidDataException("暂存目录身份无法确认，未删除任何内容。");
        }
        private void ValidateJournal(SetupJournal journal)
        {
            if (journal == null || journal.format != 1 || journal.appId != metadata.appId || journal.installGuid != metadata.installGuid || !Regex.IsMatch(journal.nonce ?? "", "^[a-f0-9]{32}$")) throw new InvalidDataException("上次操作恢复记录身份无效，所有文件保持原状。");
            SafeRoot(journal.root);
            var parent = Path.GetDirectoryName(journal.root);
            if (journal.operation == "install")
            {
                if (journal.phase != "preparing" && journal.phase != "switching" && journal.phase != "committed") throw new InvalidDataException("安装恢复阶段无效。");
                if (String.IsNullOrEmpty(journal.stage) || String.IsNullOrEmpty(journal.backup) || !Same(journal.stage, Path.Combine(parent, ".xuzuo-stage-" + journal.nonce)) || !Same(journal.backup, Path.Combine(parent, ".xuzuo-backup-" + journal.nonce))) throw new InvalidDataException("安装恢复路径不匹配，未移动文件。");
            }
            else if (journal.operation == "uninstall")
            {
                if (journal.phase != "moving" && journal.phase != "committed") throw new InvalidDataException("卸载恢复阶段无效。");
                if (!String.IsNullOrEmpty(journal.stage) || String.IsNullOrEmpty(journal.backup) || !Same(journal.backup, Path.Combine(parent, ".xuzuo-removed-" + journal.nonce))) throw new InvalidDataException("卸载恢复路径不匹配，未移动文件。");
            }
            else throw new InvalidDataException("操作恢复记录类型无效。");
            foreach (var value in new[] { journal.stage, journal.backup }.Where(value => !String.IsNullOrEmpty(value)))
            {
                NoReparse(value);
                if (!Same(Path.GetDirectoryName(value), parent) || !Path.GetFileName(value).EndsWith(journal.nonce, StringComparison.Ordinal) || Same(value, journal.root)) throw new InvalidDataException("恢复记录路径越界，未移动文件。");
            }
            if (journal.newManifest != null) ValidateManifest(journal.newManifest, null);
            if (journal.oldManifest != null) ValidateManifest(journal.oldManifest, null);
            if (journal.shortcuts == null || journal.installRegistry == null || journal.uninstallRegistry == null || journal.shortcuts.Keys.Any(path => !Same(path, ShortcutFile(true)) && !Same(path, ShortcutFile(false)))) throw new InvalidDataException("恢复记录缺少有效的登记快照。");
            var known = new HashSet<string>((journal.oldManifest == null ? new List<SetupFile>() : journal.oldManifest.files).Select(file => file.path).Concat(new[] { ReceiptPath, OwnerFile, "uninstallerIcon.ico" }), StringComparer.OrdinalIgnoreCase);
            if (!String.IsNullOrEmpty(journal.legacyDisabled))
            {
                Relative(journal.legacyDisabled);
                var oldCommand = journal.uninstallRegistry.Values.FirstOrDefault(value => value.Name == "UninstallString");
                var executable = UninstallExecutable(oldCommand == null ? "" : Convert.ToString(oldCommand.Value));
                if (executable == null || !Inside(journal.root, executable) || !String.Equals(Full(executable).Substring(journal.root.Length + 1).Replace('\\', '/'), journal.legacyDisabled, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("旧版维护入口恢复信息不匹配。");
                known.Add(journal.legacyDisabled);
            }
            foreach (var file in metadata.legacyFiles ?? new List<SetupFile>()) known.Add(file.path);
            foreach (var file in journal.moved ?? new List<string>()) { Relative(file); if (journal.operation != "uninstall" || !known.Contains(file)) throw new InvalidDataException("恢复记录包含非受管文件，未移动任何文件。"); }
        }
        private static IEnumerable<string> ParentDirectories(IEnumerable<string> files)
        {
            return files.SelectMany(file => { var values = new List<string>(); var value = file; while (value.Contains("/")) { value = value.Substring(0, value.LastIndexOf('/')); values.Add(value); } return values; }).Distinct(StringComparer.OrdinalIgnoreCase).OrderByDescending(value => value.Length);
        }
        private void Prune(string root, IEnumerable<string> files)
        {
            foreach (var relative in ParentDirectories(files)) { var directory = At(root, relative); if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory); }
            if (Directory.Exists(root) && !Directory.EnumerateFileSystemEntries(root).Any()) Directory.Delete(root);
        }
        private void DeleteOwned(string root, SetupManifest manifest, bool requireHash)
        {
            if (!Directory.Exists(root)) return; NoReparse(root);
            var paths = manifest.files.Select(file => file.path).Concat(new[] { ReceiptPath, OwnerFile }).ToList();
            foreach (var file in manifest.files)
            {
                var path = At(root, file.path);
                if (File.Exists(path) && (!requireHash || new FileInfo(path).Length == file.bytes && String.Equals(Sha(path), file.sha256, StringComparison.OrdinalIgnoreCase))) { try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
            }
            foreach (var relative in new[] { ReceiptPath, OwnerFile }) { var file = At(root, relative); if (File.Exists(file)) File.Delete(file); }
            Prune(root, paths);
        }
        public void RecoverPending()
        {
            NoReparse(journalPath);
            if (!File.Exists(journalPath)) return;
            var journal = SetupJson.File<SetupJournal>(journalPath); ValidateJournal(journal);
            Report("恢复上次操作", "正在恢复未完成的安装事务，不修改用户资料。", null, true);
            if (journal.phase == "committed") { File.Delete(journalPath); return; }
            Rollback(journal); File.Delete(journalPath);
        }
        public bool HasRecoverableOperation(string root)
        {
            NoReparse(journalPath); if (!File.Exists(journalPath)) return false;
            var journal = SetupJson.File<SetupJournal>(journalPath); ValidateJournal(journal);
            if (!Same(root, journal.root) || journal.phase == "committed") return false;
            if (Directory.Exists(journal.backup)) ValidateOwner(journal.backup, journal.nonce, OperationFile);
            else if (journal.operation == "uninstall" && journal.moved.Count != 0) throw new InvalidDataException("恢复副本已不可用，记录保留。");
            if (journal.operation == "install" && Directory.Exists(journal.stage)) ValidateOwner(journal.stage, journal.nonce, OwnerFile);
            return true;
        }
        private void Rollback(SetupJournal journal)
        {
            ValidateJournal(journal);
            if (journal.operation == "install")
            {
                if (Directory.Exists(journal.backup)) ValidateOwner(journal.backup, journal.nonce, OperationFile);
                if (Directory.Exists(journal.root) && File.Exists(Path.Combine(journal.root, OwnerFile)))
                {
                    var owner = SetupJson.File<Dictionary<string, object>>(Path.Combine(journal.root, OwnerFile));
                    if (Convert.ToString(owner["nonce"]) == journal.nonce)
                    {
                        ValidateOwner(journal.root, journal.nonce, OwnerFile);
                        if (Directory.Exists(journal.stage)) throw new IOException("恢复暂存目录已被占用，已保留全部副本。");
                        Directory.Move(journal.root, journal.stage);
                    }
                }
                if (Directory.Exists(journal.backup))
                {
                    if (!String.IsNullOrEmpty(journal.legacyDisabled)) { var original = At(journal.backup, journal.legacyDisabled); var disabled = original + ".disabled.bin"; if (File.Exists(disabled)) { if (File.Exists(original)) throw new IOException("旧维护入口恢复位置已被占用。"); File.Move(disabled, original); } }
                    if (Directory.Exists(journal.root)) throw new IOException("原目录已被其它内容占用，已保留备份，请先检查。"); File.Delete(Path.Combine(journal.backup, OperationFile)); Directory.Move(journal.backup, journal.root);
                }
                else if (File.Exists(Path.Combine(journal.root, OperationFile))) { ValidateOwner(journal.root, journal.nonce, OperationFile); File.Delete(Path.Combine(journal.root, OperationFile)); }
                if (Directory.Exists(journal.stage)) { ValidateOwner(journal.stage, journal.nonce, OwnerFile); DeleteOwned(journal.stage, journal.newManifest, false); }
            }
            else if (journal.operation == "uninstall")
            {
                if (Directory.Exists(journal.backup)) ValidateOwner(journal.backup, journal.nonce, OperationFile);
                else if ((journal.moved ?? new List<string>()).Count != 0) throw new IOException("卸载隔离目录已不可用，恢复记录保留，未改动原目录。");
                Directory.CreateDirectory(journal.root);
                foreach (var relative in (journal.moved ?? new List<string>()).Reverse())
                {
                    var source = At(journal.backup, relative); var target = At(journal.root, relative);
                    if (!File.Exists(source)) continue;
                    if (File.Exists(target)) throw new IOException("恢复目标出现新文件，隔离副本已保留，未覆盖。");
                    Directory.CreateDirectory(Path.GetDirectoryName(target)); File.Move(source, target);
                }
                if (Directory.Exists(journal.backup)) { ValidateOwner(journal.backup, journal.nonce, OperationFile); File.Delete(Path.Combine(journal.backup, OperationFile)); Prune(journal.backup, journal.moved); }
            }
            else throw new InvalidDataException("操作恢复记录类型无效。");
            RestoreRegistry(installKey, journal.installRegistry); RestoreRegistry(metadata.uninstallRegistryKey, journal.uninstallRegistry); RestoreShortcuts(journal.shortcuts);
        }
        private void Extract(string stage, SetupManifest manifest)
        {
            var expected = manifest.files.ToDictionary(file => file.path, StringComparer.OrdinalIgnoreCase);
            using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Setup.Payload.zip"))
            {
                if (payload == null || !payload.CanSeek) throw new InvalidDataException("安装压缩资源不可用。");
                using (var archive = new ZipArchive(payload, ZipArchiveMode.Read, true))
                {
                    var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    if (archive.Entries.Count > manifest.files.Count * 4 + 1000) throw new InvalidDataException("压缩包目录项超过限制。");
                    foreach (var entry in archive.Entries)
                    {
                        var name = entry.FullName;
                        if (name.EndsWith("/")) { Relative(name.TrimEnd('/')); continue; }
                        Relative(name); SetupFile file;
                        if (!expected.TryGetValue(name, out file) || !found.Add(name) || entry.Length != file.bytes) throw new InvalidDataException("压缩包内容与安装清单不一致。");
                    }
                    if (found.Count != expected.Count) throw new InvalidDataException("安装包缺少清单中的文件。");
                    var total = Math.Max(1, manifest.files.Sum(file => file.bytes)); long written = 0;
                    var buffer = new byte[65536];
                    foreach (var entry in archive.Entries.Where(entry => !entry.FullName.EndsWith("/")))
                    {
                        var file = expected[entry.FullName]; var target = At(stage, file.path); Directory.CreateDirectory(Path.GetDirectoryName(target)); NoReparse(target);
                        using (var input = entry.Open()) using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) using (var hash = SHA256.Create())
                        {
                            long bytes = 0; int count;
                            while ((count = input.Read(buffer, 0, buffer.Length)) != 0)
                            {
                                bytes = checked(bytes + count); if (bytes > file.bytes) throw new InvalidDataException("解压文件超过清单容量。");
                                output.Write(buffer, 0, count); hash.TransformBlock(buffer, 0, count, null, 0); written += count;
                                Report("正在安装", "正在解压并核验应用文件…", written * 90.0 / total);
                            }
                            hash.TransformFinalBlock(new byte[0], 0, 0); output.Flush(true);
                            if (bytes != file.bytes || !String.Equals(BitConverter.ToString(hash.Hash).Replace("-", ""), file.sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("安装文件校验失败，原应用保持不变，请重新获取安装包。");
                        }
                    }
                }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(At(stage, ReceiptPath))); SetupJson.Write(At(stage, ReceiptPath), manifest);
        }
        private List<string> ExistingFiles(string root)
        {
            var result = new List<string>(); var stack = new Stack<string>(); stack.Push(root);
            while (stack.Count > 0)
            {
                var directory = stack.Pop(); NoReparse(directory);
                foreach (var path in Directory.EnumerateFileSystemEntries(directory))
                {
                    if (result.Count > 30000) throw new IOException("原安装目录包含过多额外内容，请先整理后再升级。");
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("原安装目录包含链接，请先将额外内容移出应用目录后再升级。");
                    if (Directory.Exists(path)) stack.Push(path); else result.Add(path.Substring(root.Length + 1).Replace('\\', '/'));
                }
            }
            return result;
        }
        private void CheckUnknown(string root, SetupManifest oldManifest, SetupManifest incoming, SetupRegistration registration)
        {
            var known = new HashSet<string>((oldManifest ?? incoming).files.Select(file => file.path).Concat(new[] { ReceiptPath, OwnerFile }), StringComparer.OrdinalIgnoreCase);
            if (oldManifest == null)
            {
                if (!String.IsNullOrEmpty(registration.LegacyUninstaller) && Inside(root, registration.LegacyUninstaller) && !Same(root, registration.LegacyUninstaller)) known.Add(Full(registration.LegacyUninstaller).Substring(root.Length + 1).Replace('\\', '/'));
                known.Add("uninstallerIcon.ico");
                foreach (var file in metadata.legacyFiles ?? new List<SetupFile>()) { var path = At(root, file.path); if (File.Exists(path) && new FileInfo(path).Length == file.bytes && String.Equals(Sha(path), file.sha256, StringComparison.OrdinalIgnoreCase)) known.Add(file.path); }
            }
            var unknown = ExistingFiles(root).Where(file => !known.Contains(file)).Take(3).ToArray();
            if (unknown.Length > 0) throw new IOException("原应用目录包含额外文件，未覆盖或删除。请先将这些内容移出应用目录后重试：" + String.Join("、", unknown));
        }
        public SetupResult Install(string value, bool desktop)
        {
            RecoverPending(); var root = Full(value); SafeRoot(root); var registration = ReadRegistration();
            if (registration != null && registration.Machine) throw new InvalidOperationException("检测到需要管理员权限的整机安装。本安装器仅管理当前用户安装，不会提权或移除整机应用。");
            SetupManifest old = null;
            if (registration != null)
            {
                if (!Same(root, registration.Root)) throw new InvalidOperationException("升级请使用原登记的安装位置；更换位置请先卸载应用，创作资料会保留。");
                ValidateRegisteredRoot(root); old = InstalledManifest(root);
                Version installed, incoming;
                if (Version.TryParse((registration.Version ?? "").Split('-')[0], out installed) && Version.TryParse(metadata.version.Split('-')[0], out incoming) && installed > incoming) throw new InvalidOperationException("已安装较新版本，未覆盖现有应用。");
            }
            else if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any()) throw new IOException("新安装请选择独立的空文件夹，已有内容不会被覆盖。");
            var manifest = ReadPayloadManifest();
            RejectOtherRunningCopies(root);
            if (registration != null) CheckUnknown(root, old, manifest, registration);
            foreach (var shortcut in new[] { ShortcutFile(false) }.Concat(desktop ? new[] { ShortcutFile(true) } : new string[0])) if (!ShortcutOwned(shortcut, root)) throw new IOException("已存在指向其它位置的同名快捷方式，请先处理后再重试。");
            var parent = Path.GetDirectoryName(root); Directory.CreateDirectory(parent); NoReparse(parent);
            if (new DriveInfo(Path.GetPathRoot(root)).AvailableFreeSpace < manifest.files.Sum(file => file.bytes) + 33554432L) throw new IOException("目标磁盘空间不足，请选择其它位置。");
            var nonce = Guid.NewGuid().ToString("N");
            var journal = new SetupJournal { format = 1, appId = metadata.appId, installGuid = metadata.installGuid, operation = "install", phase = "preparing", root = root, stage = Path.Combine(parent, ".xuzuo-stage-" + nonce), backup = Path.Combine(parent, ".xuzuo-backup-" + nonce), nonce = nonce, oldManifest = old, newManifest = manifest, moved = new List<string>(), installRegistry = Snapshot(installKey), uninstallRegistry = Snapshot(metadata.uninstallRegistryKey), shortcuts = SnapshotShortcuts() };
            SaveJournal(journal);
            try
            {
                PrepareOwnedDirectory(journal.stage, nonce, OwnerFile); Extract(journal.stage, manifest);
                if (registration != null) { CloseApplication(root); CheckUnknown(root, old, manifest, registration); }
                RejectOtherRunningCopies(root);
                Report("正在完成安装", "正在切换应用并更新当前用户入口…", 93, true);
                journal.phase = "switching"; SaveJournal(journal);
                if (Directory.Exists(root)) { SetupJson.Write(Path.Combine(root, OperationFile), new { format = 1, appId = metadata.appId, installGuid = metadata.installGuid, nonce = nonce }); Directory.Move(root, journal.backup); }
                if (registration != null && old == null && !String.IsNullOrEmpty(registration.LegacyUninstaller) && Inside(root, registration.LegacyUninstaller))
                {
                    var relative = Full(registration.LegacyUninstaller).Substring(root.Length + 1).Replace('\\', '/'); var legacy = At(journal.backup, relative);
                    if (File.Exists(legacy)) { journal.legacyDisabled = relative; SaveJournal(journal); File.Move(legacy, legacy + ".disabled.bin"); }
                }
                Directory.Move(journal.stage, root); Register(root, desktop, manifest);
                journal.phase = "committed"; SaveJournal(journal);
                var retained = "";
                if (Directory.Exists(journal.backup))
                {
                    try
                    {
                        if (old != null) { DeleteOwned(journal.backup, old, true); ValidateOwner(journal.backup, nonce, OperationFile); File.Delete(Path.Combine(journal.backup, OperationFile)); if (!Directory.EnumerateFileSystemEntries(journal.backup).Any()) Directory.Delete(journal.backup); }
                        else if (registration == null) { ValidateOwner(journal.backup, nonce, OperationFile); File.Delete(Path.Combine(journal.backup, OperationFile)); if (!Directory.EnumerateFileSystemEntries(journal.backup).Any()) Directory.Delete(journal.backup); }
                    }
                    catch (IOException) { } catch (UnauthorizedAccessException) { }
                    if (Directory.Exists(journal.backup)) retained = journal.backup;
                }
                File.Delete(journalPath); Report("安装完成", "应用已安装，创作资料保持不变。", 100, true);
                return new SetupResult { Root = root, RetainedDirectory = retained, Detail = String.IsNullOrEmpty(retained) ? "应用已安装，工作区、费用与密钥资料均保留。" : "应用已安装。旧版或改动过的文件副本保留在：" + retained };
            }
            catch (Exception original)
            {
                if (journal.phase == "committed") throw new IOException("应用已经安装，但清理恢复记录尚未完成。请重新打开安装器核对；现有文件保留。", original);
                try { Rollback(journal); File.Delete(journalPath); }
                catch (Exception recovery) { throw new IOException("操作未完成，恢复副本已保留。请重试恢复；不要删除暂存目录。" + Environment.NewLine + recovery.Message, original); }
                throw;
            }
        }
        private void MoveForUninstall(SetupJournal journal, string relative)
        {
            var source = At(journal.root, relative); if (!File.Exists(source)) return;
            var target = At(journal.backup, relative); Directory.CreateDirectory(Path.GetDirectoryName(target));
            journal.moved.Add(relative); SaveJournal(journal); File.Move(source, target);
        }
        public SetupResult Uninstall(string value)
        {
            RecoverPending(); var root = Full(value); ValidateRegisteredRoot(root); var registration = ReadRegistration();
            var manifest = InstalledManifest(root); var legacy = manifest == null;
            if (manifest == null) { if (!HasPayload) throw new InvalidOperationException("旧安装缺少受管清单，请使用最新完整安装包的卸载入口，未删除任何文件。"); manifest = ReadPayloadManifest(); }
            CloseApplication(root);
            var nonce = Guid.NewGuid().ToString("N"); var backup = Path.Combine(Path.GetDirectoryName(root), ".xuzuo-removed-" + nonce);
            var journal = new SetupJournal { format = 1, appId = metadata.appId, installGuid = metadata.installGuid, operation = "uninstall", phase = "moving", root = root, backup = backup, nonce = nonce, oldManifest = manifest, moved = new List<string>(), installRegistry = Snapshot(installKey), uninstallRegistry = Snapshot(metadata.uninstallRegistryKey), shortcuts = SnapshotShortcuts() };
            if (legacy && registration != null && !String.IsNullOrEmpty(registration.LegacyUninstaller) && Inside(root, registration.LegacyUninstaller)) journal.legacyDisabled = Full(registration.LegacyUninstaller).Substring(root.Length + 1).Replace('\\', '/');
            SaveJournal(journal); PrepareOwnedDirectory(backup, nonce, OperationFile);
            try
            {
                var index = 0;
                foreach (var file in manifest.files.Where(file => !file.path.Equals(MaintenancePath, StringComparison.OrdinalIgnoreCase)))
                {
                    var path = At(root, file.path); index++;
                    if (!File.Exists(path)) continue;
                    if (!legacy && (new FileInfo(path).Length != file.bytes || !String.Equals(Sha(path), file.sha256, StringComparison.OrdinalIgnoreCase))) continue;
                    MoveForUninstall(journal, file.path); Report("正在卸载", "只移除安装清单内的应用文件，保留创作资料…", index * 90.0 / manifest.files.Count);
                }
                if (legacy && registration != null && !String.IsNullOrEmpty(registration.LegacyUninstaller) && Inside(root, registration.LegacyUninstaller)) MoveForUninstall(journal, Full(registration.LegacyUninstaller).Substring(root.Length + 1).Replace('\\', '/'));
                if (legacy) MoveForUninstall(journal, "uninstallerIcon.ico");
                if (legacy) foreach (var file in metadata.legacyFiles ?? new List<SetupFile>()) { var path = At(root, file.path); if (!journal.moved.Contains(file.path, StringComparer.OrdinalIgnoreCase) && File.Exists(path) && new FileInfo(path).Length == file.bytes && String.Equals(Sha(path), file.sha256, StringComparison.OrdinalIgnoreCase)) MoveForUninstall(journal, file.path); }
                MoveForUninstall(journal, ReceiptPath); MoveForUninstall(journal, OwnerFile);
                Report("正在完成卸载", "正在移除当前用户的启动入口…", 95, true);
                foreach (var path in journal.shortcuts.Keys) if (File.Exists(path) && ShortcutOwned(path, root)) File.Delete(path);
                using (var hive = Hive(RegistryHive.CurrentUser)) { hive.DeleteSubKeyTree(metadata.uninstallRegistryKey, false); hive.DeleteSubKeyTree(installKey, false); }
                var maintenance = manifest.files.First(file => file.path.Equals(MaintenancePath, StringComparison.OrdinalIgnoreCase));
                var maintenancePath = At(root, MaintenancePath);
                if (File.Exists(maintenancePath) && (legacy || new FileInfo(maintenancePath).Length == maintenance.bytes && String.Equals(Sha(maintenancePath), maintenance.sha256, StringComparison.OrdinalIgnoreCase))) MoveForUninstall(journal, MaintenancePath);
                journal.phase = "committed"; SaveJournal(journal);
                if (legacy)
                {
                    foreach (var relative in journal.moved.Where(path => path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)))
                    {
                        var file = At(backup, relative); if (!File.Exists(file)) continue; var retired = file + ".disabled.bin";
                        if (File.Exists(retired)) retired = file + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".disabled.bin";
                        File.Move(file, retired);
                    }
                }
                else
                {
                    foreach (var relative in journal.moved)
                    {
                        var path = At(backup, relative); if (!File.Exists(path)) continue;
                        var expected = manifest.files.FirstOrDefault(file => file.path.Equals(relative, StringComparison.OrdinalIgnoreCase));
                        if (expected != null && (new FileInfo(path).Length != expected.bytes || !String.Equals(Sha(path), expected.sha256, StringComparison.OrdinalIgnoreCase))) continue;
                        try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                    }
                    var owner = Path.Combine(backup, OwnerFile); if (File.Exists(owner)) File.Delete(owner);
                    File.Delete(Path.Combine(backup, OperationFile)); Prune(backup, journal.moved);
                }
                Prune(root, journal.moved); File.Delete(journalPath);
                var retained = Directory.Exists(root) ? root : Directory.Exists(backup) ? backup : "";
                Report("卸载完成", "应用入口已移除，工作区、历史费用和密钥资料均保留。", 100, true);
                return new SetupResult { Root = root, RetainedDirectory = retained, Detail = String.IsNullOrEmpty(retained) ? "应用已卸载。工作区、费用、密钥及应用资料仍保留在原位置。" : "应用已卸载。额外或改动过的文件保留在：" + retained + Environment.NewLine + "工作区、费用和密钥资料未删除。" };
            }
            catch (Exception original)
            {
                if (journal.phase == "committed") throw new IOException("应用入口已经移除，但部分隔离文件尚未清理。它们仍保留在：" + backup, original);
                try { Rollback(journal); File.Delete(journalPath); }
                catch (Exception recovery) { throw new IOException("卸载未完成，隔离文件和恢复记录已保留。" + Environment.NewLine + recovery.Message, original); }
                throw;
            }
        }
        public void Launch(string value)
        {
            if (metadata.validation) throw new InvalidOperationException("独立验证构建不会启动应用或访问正常应用资料。");
            var root = Full(value); ValidateRegisteredRoot(root);
            RejectOtherRunningCopies(root);
            Process.Start(new ProcessStartInfo { FileName = At(root, metadata.executable), WorkingDirectory = root, UseShellExecute = false });
        }
        public IList<SetupLocation> LoadLocations()
        {
            var result = new List<SetupLocation>();
            foreach (var item in new[] { new { Name = "桌面", Path = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) }, new { Name = "文档", Path = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) }, new { Name = "个人程序", Path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs") } }) if (!String.IsNullOrEmpty(item.Path)) result.Add(new SetupLocation { Name = item.Name, Path = item.Path, IsDrive = false });
            var bitmap = GetLogicalDrives();
            for (var index = 0; index < 26; index++) if ((bitmap & (1u << index)) != 0) { var root = ((char)('A' + index)) + ":\\"; var type = GetDriveType(root); if (type == 2 || type == 3) result.Add(new SetupLocation { Name = (type == 2 ? "可移动磁盘 (" : "本地磁盘 (") + root.Substring(0, 2) + ")", Path = root, IsDrive = true }); }
            return result;
        }
        public SetupDirectoryListing ListInitialDirectory(string value)
        {
            var directory = Full(value);
            while (!Directory.Exists(directory))
            {
                if (File.Exists(directory)) throw new IOException("此位置是文件，请另选安装文件夹。");
                var parent = Directory.GetParent(directory);
                if (parent == null) throw new DirectoryNotFoundException("目录不存在或磁盘不可用，请重新选择。");
                directory = parent.FullName;
            }
            return ListDirectories(directory);
        }
        public SetupDirectoryListing ListDirectories(string value)
        {
            var directory = Full(value); NoReparse(directory); if (!LocalDrive(directory) || !Directory.Exists(directory)) throw new DirectoryNotFoundException("目录不存在或磁盘不可用，请重新选择。");
            var result = new List<SetupDirectory>();
            foreach (var path in Directory.EnumerateDirectories(directory))
            {
                if (result.Count >= 500) break;
                try { if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0) result.Add(new SetupDirectory { Name = Path.GetFileName(path), Path = path }); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
            result.Sort((left, right) => StringComparer.CurrentCultureIgnoreCase.Compare(left.Name, right.Name));
            var parent = Directory.GetParent(directory);
            return new SetupDirectoryListing { Path = directory, ParentPath = parent == null ? null : parent.FullName, Directories = result };
        }
        public SetupDirectoryListing CreateFolder(string directory, string name)
        {
            var parent = Full(directory); NoReparse(parent); ValidateName(name);
            if (!LocalDrive(parent) || !Directory.Exists(parent)) throw new DirectoryNotFoundException("父目录不存在。");
            var target = Full(Path.Combine(parent, name)); SafeRoot(target);
            if (!CreateDirectory(target, IntPtr.Zero)) { var error = Marshal.GetLastWin32Error(); if (error == 183) throw new IOException("同名文件或文件夹已存在，请换一个名称。"); throw new Win32Exception(error, "文件夹未能创建，请检查权限或磁盘连接。"); }
            return ListDirectories(target);
        }
        public static void SelfTest()
        {
            foreach (var invalid in new[] { "../outside", "/absolute", "C:/absolute", "a\\b", "a//b", "a/../b", "a:stream", "con.txt", "a. " })
            { var rejected = false; try { Relative(invalid); } catch (InvalidDataException) { rejected = true; } if (!rejected) throw new Exception("Unsafe path accepted: " + invalid); }
            if (Relative("resources/app.asar") != "resources/app.asar") throw new Exception("Valid path rejected");
        }
    }
}
