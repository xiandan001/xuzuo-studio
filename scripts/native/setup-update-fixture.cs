using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Collections.Generic;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

#if FIXTURE_APP
[assembly: AssemblyProduct("Xuzuo OTA isolated fixture")]
internal static class OtaFixtureApplication
{
    public static int Main(string[] args)
    {
        if (args.Length != 2) return 1;
        using (var process = Process.GetCurrentProcess())
        {
            var startedAt = (process.StartTime.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            File.WriteAllText(args[0], "{\"pid\":" + process.Id + ",\"startedAt\":" + startedAt.ToString("R", CultureInfo.InvariantCulture) + "}\n");
        }
        while (!File.Exists(args[1])) Thread.Sleep(50);
        return 0;
    }
}
#else
namespace Xuzuo.Setup
{
    internal static class SetupUpdateFixture
    {
        private static void Check(bool value, string message) { if (!value) throw new InvalidDataException(message); }
        private static string Full(string value) { return Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar); }
        private static bool Same(string left, string right) { return String.Equals(Full(left), Full(right), StringComparison.OrdinalIgnoreCase); }
        private static void NoLinks(string value)
        {
            var full = Full(value); var cursor = Path.GetPathRoot(full);
            foreach (var part in full.Substring(cursor.Length).Split(new[] { Path.DirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
            {
                cursor = Path.Combine(cursor, part);
                try { Check((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) == 0, "Validation path contains a reparse point."); }
                catch (FileNotFoundException) { break; } catch (DirectoryNotFoundException) { break; }
            }
        }
        private static string Owned(SetupMetadata metadata, string value)
        {
            var full = Full(value); var root = Full(metadata.validationRoot);
            Check(full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase), "Fixture target escaped validation root."); NoLinks(full); return full;
        }
        private static string Sha(string file)
        {
            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
        private static byte[] Small(Stream stream, int maximum)
        {
            using (var output = new MemoryStream())
            {
                var bytes = new byte[65536]; int count;
                while ((count = stream.Read(bytes, 0, bytes.Length)) != 0) { Check(output.Length + count <= maximum, "JSON resource too large."); output.Write(bytes, 0, count); }
                return output.ToArray();
            }
        }
        private static byte[] Resource(Assembly assembly, string name)
        {
            using (var stream = assembly.GetManifestResourceStream(name)) { Check(stream != null, "Source resource missing."); return Small(stream, 16 * 1024 * 1024); }
        }
        private static void Relative(string value)
        {
            Check(!String.IsNullOrEmpty(value) && !Path.IsPathRooted(value) && !value.Contains("\\"), "Unsafe source entry.");
            foreach (var part in value.Split('/'))
            {
                Check(part.Length != 0 && part != "." && part != ".." && part == part.TrimEnd(' ', '.') && part.IndexOfAny(new[] { '<', '>', ':', '"', '|', '?', '*' }) < 0 && !part.Any(Char.IsControl), "Unsafe source entry.");
                var device = part.Split('.')[0].ToUpperInvariant();
                Check(device != "CON" && device != "PRN" && device != "AUX" && device != "NUL" && !(device.Length == 4 && (device.StartsWith("COM") || device.StartsWith("LPT")) && "123456789\u00b9\u00b2\u00b3".IndexOf(device[3]) >= 0), "Reserved source entry.");
            }
        }
        private static object ExtractSource(SetupMetadata metadata, string[] args)
        {
            var input = Full(args[1]); var destination = Owned(metadata, args[2]); NoLinks(input);
            Check(File.Exists(input), "Pinned source installer missing.");
            Check(Directory.Exists(destination) && !Directory.EnumerateFileSystemEntries(destination).Any(), "Source destination must be new and empty.");
            using (var locked = new FileStream(input, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                using (var hash = SHA256.Create()) Check(BitConverter.ToString(hash.ComputeHash(locked)).Replace("-", "").ToLowerInvariant() == args[3], "Pinned source installer SHA differs.");
                // Read embedded data only; the production installer entry point is never invoked.
                var assembly = Assembly.ReflectionOnlyLoadFrom(input); var utf8 = new UTF8Encoding(false, true);
                var metadataBytes = Resource(assembly, "Setup.Metadata.json"); var manifestBytes = Resource(assembly, "Setup.Manifest.json");
                var source = SetupJson.Serializer().Deserialize<SetupMetadata>(utf8.GetString(metadataBytes));
                var manifest = SetupJson.Serializer().Deserialize<SetupManifest>(utf8.GetString(manifestBytes));
                Check(source != null && source.format == 1 && !source.validation && source.version == args[4] && source.appId == args[5] && source.executable == metadata.executable, "Source metadata identity differs.");
                Check(manifest != null && manifest.format == 1 && manifest.version == source.version && manifest.appId == source.appId && manifest.executable == source.executable && manifest.files != null && manifest.files.Count == 74, "Expected a full source runtime manifest.");
                var expected = new Dictionary<string, SetupFile>(StringComparer.OrdinalIgnoreCase); long total = 0;
                foreach (var item in manifest.files)
                {
                    Relative(item.path); Check(item.bytes >= 0 && item.bytes <= 536870912 && item.sha256 != null && item.sha256.Length == 64 && item.sha256.All(c => c >= '0' && c <= '9' || c >= 'a' && c <= 'f') && !expected.ContainsKey(item.path), "Invalid source manifest entry.");
                    expected.Add(item.path, item); total = checked(total + item.bytes);
                }
                Check(total <= 2147483648L && expected.ContainsKey(source.executable) && expected.ContainsKey("resources/app.asar") && expected.ContainsKey(SetupEngine.MaintenancePath), "Source runtime is incomplete.");
                var spellings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var item in manifest.files)
                {
                    var parent = item.path; int slash;
                    while ((slash = parent.LastIndexOf('/')) >= 0) { parent = parent.Substring(0, slash); Check(!expected.ContainsKey(parent), "File/directory collision."); string old; if (spellings.TryGetValue(parent, out old)) Check(old == parent, "Directory case collision."); else spellings.Add(parent, parent); }
                }
                var runtime = Path.Combine(destination, "runtime"); Directory.CreateDirectory(runtime); NoLinks(runtime);
                using (var stream = assembly.GetManifestResourceStream("Setup.Payload.zip"))
                {
                    Check(stream != null, "Source payload missing.");
                    using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, false))
                    {
                        Check(zip.Entries.Count == expected.Count, "Source ZIP file set differs."); var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var entry in zip.Entries)
                        {
                            Relative(entry.FullName); Check(seen.Add(entry.FullName) && expected.ContainsKey(entry.FullName), "Duplicate/unknown source ZIP entry.");
                            var file = expected[entry.FullName]; var attributes = unchecked((uint)entry.ExternalAttributes); var unixType = (attributes >> 16) & 0xf000;
                            Check(entry.FullName == file.path && entry.Length == file.bytes && (attributes & 0x410) == 0 && (unixType == 0 || unixType == 0x8000), "Invalid source ZIP entry.");
                        }
                        foreach (var entry in zip.Entries)
                        {
                            var file = expected[entry.FullName]; var target = Owned(metadata, Path.Combine(runtime, entry.FullName.Replace('/', '\\')));
                            Check(target.StartsWith(runtime + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase), "Source output escaped runtime."); Directory.CreateDirectory(Path.GetDirectoryName(target)); NoLinks(target);
                            using (var contents = entry.Open()) using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) using (var hash = SHA256.Create())
                            {
                                var buffer = new byte[65536]; long bytes = 0; int count;
                                while ((count = contents.Read(buffer, 0, buffer.Length)) != 0) { bytes = checked(bytes + count); Check(bytes <= file.bytes, "Source entry exceeded length."); output.Write(buffer, 0, count); hash.TransformBlock(buffer, 0, count, buffer, 0); }
                                hash.TransformFinalBlock(new byte[0], 0, 0); Check(bytes == file.bytes && BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() == file.sha256, "Source entry hash differs."); output.Flush(true);
                            }
                        }
                    }
                }
                var manifestFile = Path.Combine(destination, "manifest.json"); var metadataFile = Path.Combine(destination, "metadata.json");
                using (var output = new FileStream(manifestFile, FileMode.CreateNew)) output.Write(manifestBytes, 0, manifestBytes.Length);
                using (var output = new FileStream(metadataFile, FileMode.CreateNew)) output.Write(metadataBytes, 0, metadataBytes.Length);
                return new { passed = true, runtime = runtime, manifestFile = manifestFile, metadataFile = metadataFile, files = expected.Count, bytes = total };
            }
        }
        private static object RegistrySnapshot(string path)
        {
            using (var hive = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64)) using (var key = hive.OpenSubKey(path))
            {
                return new { exists = key != null, values = key == null ? new object[0] : key.GetValueNames().OrderBy(name => name, StringComparer.Ordinal).Select(name => (object)new { name = name, kind = key.GetValueKind(name).ToString(), value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) }).ToArray() };
            }
        }
        private static object Status(SetupEngine engine, string root)
        {
            var metadata = engine.Metadata; Owned(metadata, root);
            var shortcuts = new List<object>();
            foreach (var folder in new[] { "Desktop", "StartMenu" })
            {
                var file = Owned(metadata, Path.Combine(metadata.shortcutRoot, folder, metadata.shortcutName + ".lnk"));
                shortcuts.Add(new { folder = folder, exists = File.Exists(file), sha256 = File.Exists(file) ? Sha(file) : null });
            }
            return new { passed = true, registration = engine.ReadRegistration(), installRegistry = RegistrySnapshot("Software\\" + metadata.installGuid), uninstallRegistry = RegistrySnapshot(metadata.uninstallRegistryKey), shortcuts = shortcuts, pendingJournal = File.Exists(Path.Combine(metadata.validationRoot, "setup-state", metadata.installGuid, "transaction.json")) };
        }
        private static object PostSwitchFailure(SetupEngine engine, string root)
        {
            var metadata = engine.Metadata; root = Owned(metadata, root); var before = engine.ReadRegistration();
            Check(before != null && Same(before.Root, root) && !before.Machine, "Expected an owned installed baseline.");
            var journalPath = Owned(metadata, Path.Combine(metadata.validationRoot, "setup-state", metadata.installGuid, "transaction.json"));
            string held = null, backup = null; var observed = false; var acceptingEvents = true; Exception watcherError = null; var gate = new object();
            using (var renamed = new ManualResetEvent(false)) using (var watcher = new FileSystemWatcher(Path.GetDirectoryName(root)))
            {
                watcher.NotifyFilter = NotifyFilters.DirectoryName;
                watcher.Renamed += delegate(object sender, RenamedEventArgs value) { lock (gate) { if (acceptingEvents && backup != null && Same(value.OldFullPath, root) && Same(value.FullPath, backup)) { observed = true; renamed.Set(); } } };
                watcher.Error += delegate(object sender, ErrorEventArgs value) { lock (gate) { if (acceptingEvents) watcherError = value.GetException(); } };
                watcher.Disposed += delegate { lock (gate) { acceptingEvents = false; } };
                watcher.EnableRaisingEvents = true;
                engine.Progress = delegate(string stage, string detail, double? percent)
                {
                    if (stage != "正在完成安装" || percent != 93 || held != null) return;
                    var journal = SetupJson.File<SetupJournal>(journalPath); var stageRoot = Owned(metadata, journal.stage);
                    Check(journal.root != null && Same(journal.root, root) && journal.phase == "preparing" && Path.GetFileName(stageRoot) == ".xuzuo-stage-" + journal.nonce, "Unexpected real install journal.");
                    var owner = SetupJson.File<Dictionary<string, object>>(Path.Combine(stageRoot, ".xuzuo-setup-owner.json"));
                    Check(Convert.ToString(owner["appId"]) == metadata.appId && Convert.ToString(owner["installGuid"]) == metadata.installGuid && Convert.ToString(owner["nonce"]) == journal.nonce, "Stage owner differs.");
                    held = Owned(metadata, Path.Combine(metadata.validationRoot, "fault-held-stage-" + journal.nonce)); Check(!Directory.Exists(held) && !File.Exists(held), "Held-stage target exists.");
                    lock (gate) { backup = Owned(metadata, journal.backup); }
                    Directory.Move(stageRoot, held);
                };
                var failed = false; try { engine.Install(root, true); } catch (IOException) { failed = true; }
                finally { engine.Progress = null; }
                renamed.WaitOne(1500); watcher.EnableRaisingEvents = false;
                lock (gate) { acceptingEvents = false; Check(watcherError == null && observed, "Actual old-root swap was not observed."); }
                Check(failed && held != null && Directory.Exists(held), "Post-switch failure was not exercised.");
                engine.ValidateRegisteredRoot(root); Check(engine.ReadRegistration().Version == before.Version && !File.Exists(journalPath), "Old installation or journal did not recover.");
                return new { passed = true, oldRootSwapObserved = true, oldVersion = before.Version, retainedStage = held, interruptedProcessRecoveryVerified = false };
            }
        }
        private static object OwnedProcesses(SetupMetadata metadata, string executable)
        {
            executable = Owned(metadata, executable); var found = new List<object>(); var uninspectable = 0;
            foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable)))
            {
                using (process)
                {
                    try { if (!process.HasExited && Same(process.MainModule.FileName, executable)) found.Add(new { pid = process.Id, startedAt = (process.StartTime.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds }); }
                    catch { var gone = false; try { gone = process.HasExited; } catch { } if (!gone) uninspectable++; }
                }
            }
            return new { passed = true, processes = found, uninspectable = uninspectable };
        }
        private static object ProbePath(string value)
        {
            var points = new List<string>();
            for (var index = 0; index < value.Length; index++)
            {
                var point = Char.ConvertToUtf32(value, index); if (Char.IsHighSurrogate(value[index])) index++;
                points.Add("U+" + point.ToString("X4", CultureInfo.InvariantCulture));
            }
            return new { value = value, utf16Length = value.Length, codePointCount = points.Count, codePoints = points, exists = File.Exists(value) || Directory.Exists(value) };
        }
        private static object ProbeException(Exception error)
        {
            var chain = new List<object>();
            for (var current = error; current != null && chain.Count < 5; current = current.InnerException)
            {
                var message = current.Message ?? ""; var stack = current.StackTrace ?? "";
                chain.Add(new { type = current.GetType().FullName, hresult = "0x" + current.HResult.ToString("X8", CultureInfo.InvariantCulture), message = message.Substring(0, Math.Min(512, message.Length)), stack = stack.Substring(0, Math.Min(2000, stack.Length)) });
            }
            return chain;
        }
        private static object ShortcutProbe(SetupEngine engine, string original)
        {
            var metadata = engine.Metadata; original = Owned(metadata, original);
            var attributes = File.GetAttributes(original); var source = new FileInfo(original);
            Check((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0 && source.Exists && source.Length > 0 && source.Length <= 536870912 && String.Equals(source.Extension, ".exe", StringComparison.OrdinalIgnoreCase), "Expected an owned ordinary executable.");
            Check(source.Name.Any(character => character > 127), "Probe requires the original non-ASCII executable filename.");
            var ownerPath = Owned(metadata, Path.Combine(metadata.validationRoot, ".xuzuo-setup-validation.json"));
            var owner = SetupJson.File<Dictionary<string, object>>(ownerPath);
            Check(Convert.ToInt32(owner["format"]) == 1 && Convert.ToString(owner["kind"]) == "xuzuo-setup-validation" && Convert.ToString(owner["appId"]) == metadata.appId && String.Equals(Convert.ToString(owner["installGuid"]), metadata.installGuid, StringComparison.OrdinalIgnoreCase) && Same(Convert.ToString(owner["root"]), metadata.validationRoot), "Probe validation owner differs.");
            var directory = Owned(metadata, Path.Combine(metadata.validationRoot, "shortcut-probe-" + Guid.NewGuid().ToString("N")));
            Check(directory.All(character => character < 128) && !Directory.Exists(directory) && !File.Exists(directory), "Probe needs a new ASCII base directory.");
            Directory.CreateDirectory(directory); NoLinks(directory);
            var write = typeof(SetupEngine).GetMethod("WriteShortcut", BindingFlags.Instance | BindingFlags.NonPublic);
            var read = typeof(SetupEngine).GetMethod("ReadShortcutTarget", BindingFlags.Static | BindingFlags.NonPublic);
            var owned = typeof(SetupEngine).GetMethod("ShortcutOwned", BindingFlags.Instance | BindingFlags.NonPublic);
            Check(write != null && read != null && owned != null, "Production shortcut methods missing.");
            var cases = new[] {
                new { id = "ascii-directory-ascii-file", folder = "ascii-directory-ascii-file", filename = "application.exe" },
                new { id = "ascii-directory-original-file", folder = "ascii-directory-original-file", filename = source.Name },
                new { id = "chinese-space-directory-ascii-file", folder = "中文 空格目录", filename = "application.exe" }
            };
            var results = new List<object>(); var succeeded = 0; var digest = Sha(original);
            using (var locked = new FileStream(original, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                foreach (var item in cases)
                {
                    var child = Owned(metadata, Path.Combine(directory, item.folder));
                    var target = Owned(metadata, Path.Combine(child, item.filename)); var link = Owned(metadata, Path.Combine(child, item.id == "chinese-space-directory-ascii-file" ? "中文 快捷方式.lnk" : "probe.lnk"));
                    var stage = "copy-identical-executable"; var success = false; object error = null; string readback = null; object shell = null, shortcut = null;
                    var ownershipMatched = false; var foreignRootRejected = false; var legacyWshReadable = false; var brokenLinkRejected = false;
                    try
                    {
                        Check(!Directory.Exists(child) && !File.Exists(child), "Probe case directory exists."); Directory.CreateDirectory(child); NoLinks(child);
                        File.Copy(original, target, false); NoLinks(target); Check(new FileInfo(target).Length == source.Length && Sha(target) == digest, "Probe target bytes differ.");
                        Check(!File.Exists(link) && !Directory.Exists(link), "Probe shortcut already exists.");
                        stage = "production-WriteShortcut"; write.Invoke(engine, new object[] { link, target, child });
                        stage = "readback-Unicode-target"; NoLinks(link); Check(File.Exists(link) && (File.GetAttributes(link) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0, "Production shortcut missing or redirected.");
                        readback = Convert.ToString(read.Invoke(null, new object[] { link }));
                        Check(!String.IsNullOrEmpty(readback) && Path.IsPathRooted(readback) && Same(readback, target), "Shortcut target readback differs.");
                        var caseMetadata = SetupJson.Serializer().Deserialize<SetupMetadata>(SetupJson.Serializer().Serialize(metadata)); caseMetadata.executable = item.filename;
                        var caseEngine = new SetupEngine(caseMetadata); var linkHash = Sha(link);
                        stage = "ownership-guards"; ownershipMatched = (bool)owned.Invoke(caseEngine, new object[] { link, child });
                        foreignRootRejected = !(bool)owned.Invoke(caseEngine, new object[] { link, directory });
                        Check(ownershipMatched && foreignRootRejected && Sha(link) == linkHash, "Shortcut ownership guard failed or modified the link.");
                        if (item.id == "ascii-directory-ascii-file")
                        {
                            stage = "legacy-WSH-link"; var legacy = Owned(metadata, Path.Combine(child, "legacy-wsh.lnk")); Check(!File.Exists(legacy), "Legacy link already exists.");
                            shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                            shortcut = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { legacy });
                            shortcut.GetType().InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
                            shortcut.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                            var legacyHash = Sha(legacy); legacyWshReadable = Same(Convert.ToString(read.Invoke(null, new object[] { legacy })), target) && (bool)owned.Invoke(caseEngine, new object[] { legacy, child });
                            Check(legacyWshReadable && Sha(legacy) == legacyHash, "Legacy WSH link was not read safely.");
                            stage = "broken-link-guard"; var broken = Owned(metadata, Path.Combine(child, "broken.lnk")); File.WriteAllText(broken, "OWNED INVALID SHORTCUT", new UTF8Encoding(false)); var brokenHash = Sha(broken);
                            try { brokenLinkRejected = !(bool)owned.Invoke(caseEngine, new object[] { broken, child }); } catch (TargetInvocationException failure) { if (!(failure.InnerException is System.Runtime.InteropServices.COMException)) throw; brokenLinkRejected = true; }
                            Check(brokenLinkRejected && Sha(broken) == brokenHash, "Malformed shortcut was accepted or modified.");
                        }
                        stage = "completed"; success = true;
                    }
                    catch (Exception failure) { error = ProbeException(failure); }
                    finally
                    {
                        try { if (shortcut != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut); if (shell != null) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
                        catch (Exception failure) { success = false; if (error == null) { stage = "release-readback-COM"; error = ProbeException(failure); } }
                    }
                    if (success) succeeded++;
                    results.Add(new { id = item.id, succeeded = success, stage = stage, error = error, ownershipMatched = ownershipMatched, foreignRootRejected = foreignRootRejected, legacyWshReadable = item.id == "ascii-directory-ascii-file" ? (object)legacyWshReadable : null, brokenLinkRejected = item.id == "ascii-directory-ascii-file" ? (object)brokenLinkRejected : null, targetExists = File.Exists(target), directory = ProbePath(child), target = ProbePath(target), shortcut = ProbePath(link), readback = readback == null ? null : ProbePath(readback) });
                }
                Check(locked.Length == source.Length && Sha(original) == digest, "Original executable changed during probe.");
            }
            return new { passed = true, diagnosticCompleted = true, allCasesSucceeded = succeeded == cases.Length, originalUnchanged = true, directory = directory, original = ProbePath(original), bytes = source.Length, sha256 = digest, culture = CultureInfo.CurrentCulture.Name, uiCulture = CultureInfo.CurrentUICulture.Name, cases = results, scope = "Validation-only production WriteShortcut diagnostic; no application launch, install success, Unicode root-cause or industrial-acceptance claim." };
        }
        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                var metadata = SetupJson.Resource<SetupMetadata>("Setup.Metadata.json");
                if (!metadata.validation) throw new InvalidOperationException("Only isolated validation metadata is accepted.");
                var engine = new SetupEngine(metadata);
                object result;
                if (args.Length == 2 && (args[0] == "install" || args[0] == "install-full")) { Owned(metadata, args[1]); var installed = engine.Install(args[1], args[0] == "install-full"); result = new { passed = true, root = installed.Root, retainedDirectory = installed.RetainedDirectory }; }
                else if (args.Length == 2 && args[0] == "uninstall") { Owned(metadata, args[1]); engine.Uninstall(args[1]); result = new { passed = true }; }
                else if (args.Length == 2 && args[0] == "status") result = Status(engine, args[1]);
                else if (args.Length == 2 && args[0] == "owned-processes") result = OwnedProcesses(metadata, args[1]);
                else if (args.Length == 2 && args[0] == "post-switch-failure") result = PostSwitchFailure(engine, args[1]);
                else if (args.Length == 2 && args[0] == "shortcut-probe") result = ShortcutProbe(engine, args[1]);
                else if (args.Length == 6 && args[0] == "extract-source") result = ExtractSource(metadata, args);
                else if (args.Length == 3 && args[0] == "process-info")
                {
                    var expected = Owned(metadata, args[2]); int pid; Check(Int32.TryParse(args[1], out pid) && pid > 0, "Invalid owned PID.");
                    using (var process = Process.GetProcessById(pid)) { Check(Same(process.MainModule.FileName, expected), "Process executable differs."); result = new { passed = true, pid = pid, executable = expected, startedAt = (process.StartTime.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds, productVersion = FileVersionInfo.GetVersionInfo(expected).ProductVersion }; }
                }
                else if (args.Length == 4 && args[0] == "stop-owned-process")
                {
                    var expected = Owned(metadata, args[2]); int pid; double startedAt;
                    if (!Int32.TryParse(args[1], out pid) || pid <= 0 || !Double.TryParse(args[3], NumberStyles.Float, CultureInfo.InvariantCulture, out startedAt)) throw new InvalidDataException("Invalid owned process identity.");
                    try { using (var process = Process.GetProcessById(pid)) { Check(Same(process.MainModule.FileName, expected) && Math.Abs((process.StartTime.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds - startedAt) <= 2, "Owned process identity changed; not stopped."); process.Kill(); Check(process.WaitForExit(5000), "Owned process did not exit."); } }
                    catch (ArgumentException) { /* An already exited PID needs no action. */ }
                    result = new { passed = true };
                }
                else throw new ArgumentException("Unknown fixture operation.");
                Console.WriteLine(SetupJson.Serializer().Serialize(result));
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        }
    }
}
#endif
