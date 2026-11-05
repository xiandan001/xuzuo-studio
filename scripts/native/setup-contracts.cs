using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Xuzuo.Setup
{
    public sealed class SetupMetadata
    {
        public int format { get; set; }
        public string appId { get; set; }
        public string version { get; set; }
        public string executable { get; set; }
        public string executableProductName { get; set; }
        public string productName { get; set; }
        public string installGuid { get; set; }
        public string uninstallRegistryKey { get; set; }
        public string defaultDirectoryName { get; set; }
        public string shortcutName { get; set; }
        public bool validation { get; set; }
        public string validationRoot { get; set; }
        public string shortcutRoot { get; set; }
        public IList<SetupFile> legacyFiles { get; set; }
    }
    public sealed class SetupFile
    {
        public string path { get; set; }
        public long bytes { get; set; }
        public string sha256 { get; set; }
    }
    public sealed class SetupManifest
    {
        public int format { get; set; }
        public string appId { get; set; }
        public string version { get; set; }
        public string executable { get; set; }
        public IList<SetupFile> files { get; set; }
    }
    public sealed class SetupRegistration
    {
        public string Root;
        public string Version;
        public string LegacyUninstaller;
        public bool Machine;
    }
    public sealed class SetupResult
    {
        public string Root;
        public string Detail;
        public string RetainedDirectory;
    }
    public sealed class SetupRegistryValue
    {
        public string Name { get; set; }
        public string Kind { get; set; }
        public object Value { get; set; }
    }
    public sealed class SetupRegistrySnapshot
    {
        public bool Exists { get; set; }
        public IList<SetupRegistryValue> Values { get; set; }
    }
    public sealed class SetupJournal
    {
        public int format { get; set; }
        public string appId { get; set; }
        public string installGuid { get; set; }
        public string operation { get; set; }
        public string phase { get; set; }
        public string root { get; set; }
        public string stage { get; set; }
        public string backup { get; set; }
        public string nonce { get; set; }
        public string legacyDisabled { get; set; }
        public SetupManifest oldManifest { get; set; }
        public SetupManifest newManifest { get; set; }
        public IList<string> moved { get; set; }
        public SetupRegistrySnapshot installRegistry { get; set; }
        public SetupRegistrySnapshot uninstallRegistry { get; set; }
        public Dictionary<string, string> shortcuts { get; set; }
    }
    internal static class SetupJson
    {
        private const int Limit = 8388608;
        public static JavaScriptSerializer Serializer()
        {
            return new JavaScriptSerializer { MaxJsonLength = Limit, RecursionLimit = 64 };
        }
        public static T Read<T>(Stream stream)
        {
            if (stream == null) throw new InvalidDataException("安装资源不完整，请重新获取安装包。");
            using (stream)
            using (var reader = new StreamReader(stream, new UTF8Encoding(false, true)))
            {
                var text = new StringBuilder();
                var buffer = new char[8192]; int count;
                while ((count = reader.Read(buffer, 0, buffer.Length)) > 0)
                {
                    if (text.Length + count > Limit) throw new InvalidDataException("安装清单超过容量限制。");
                    text.Append(buffer, 0, count);
                }
                return Serializer().Deserialize<T>(text.ToString());
            }
        }
        public static T Resource<T>(string name) { return Read<T>(Assembly.GetExecutingAssembly().GetManifestResourceStream(name)); }
        public static T File<T>(string path) { return Read<T>(OpenRead(path)); }
        private static Stream OpenRead(string path)
        {
            for (var attempt = 0; ; attempt++)
            {
                try { return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete); }
                catch (IOException error)
                {
                    var code = error.HResult & 0xffff;
                    if (attempt >= 3 || (code != 2 && code != 32 && code != 33)) throw;
                    Thread.Sleep(25);
                }
            }
        }
        private static void Commit(string temporary, string path)
        {
            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    if (System.IO.File.Exists(path)) System.IO.File.Replace(temporary, path, null);
                    else System.IO.File.Move(temporary, path);
                    return;
                }
                catch (IOException error)
                {
                    var code = error.HResult & 0xffff;
                    if (attempt >= 6 || (code != 32 && code != 33 && code != 1175 && code != 1176) || !System.IO.File.Exists(path) || !System.IO.File.Exists(temporary)) throw;
                    Thread.Sleep(100);
                }
            }
        }
        public static void Write(string path, object value)
        {
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
                { writer.Write(Serializer().Serialize(value)); writer.Write('\n'); writer.Flush(); stream.Flush(true); }
                Commit(temporary, path);
            }
            finally { if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary); }
        }
    }
}
