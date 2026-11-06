using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace Xuzuo.PackageInspection
{
    public sealed class ManagedFile
    {
        public string path { get; set; }
        public long bytes { get; set; }
        public string sha256 { get; set; }
    }
    public sealed class ManagedManifest
    {
        public int format { get; set; }
        public string appId { get; set; }
        public string version { get; set; }
        public string executable { get; set; }
        public ManagedFile[] files { get; set; }
    }
    internal sealed class VerificationFailure : Exception
    {
        internal readonly string Code;
        internal VerificationFailure(string code, string message) : base(message) { Code = code; }
    }
    public static class InspectBuiltSetup
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        private static void Require(bool condition, string code, string message)
        {
            if (!condition) throw new VerificationFailure(code, message);
        }
        private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        private static string Hash(byte[] bytes) { using (var hash = SHA256.Create()) return Hex(hash.ComputeHash(bytes)); }
        private static byte[] ReadSmall(Stream stream, int limit)
        {
            using (var output = new MemoryStream())
            {
                var buffer = new byte[65536]; int count;
                while ((count = stream.Read(buffer, 0, buffer.Length)) != 0)
                {
                    Require(output.Length + count <= limit, "RESOURCE_TOO_LARGE", "Setup JSON resource exceeds its verification limit.");
                    output.Write(buffer, 0, count);
                }
                return output.ToArray();
            }
        }
        private static Stream Resource(Assembly assembly, string name)
        {
            var stream = assembly.GetManifestResourceStream(name);
            Require(stream != null, "RESOURCE_MISSING", "Missing embedded resource: " + name);
            return stream;
        }
        private static void SafeRelative(string value)
        {
            Require(!String.IsNullOrEmpty(value) && !Path.IsPathRooted(value) && value.IndexOf('\\') < 0, "UNSAFE_PATH", "Payload path must be a forward-slash relative file path.");
            foreach (var part in value.Split('/'))
            {
                Require(part.Length != 0 && part != "." && part != ".." && part == part.TrimEnd(' ', '.'), "UNSAFE_PATH", "Payload path has an unsafe component.");
                Require(part.IndexOfAny(new char[] { '<', '>', ':', '"', '|', '?', '*' }) < 0, "UNSAFE_PATH", "Payload path contains a reserved character.");
                foreach (var character in part) Require(character >= 32, "UNSAFE_PATH", "Payload path contains a control character.");
                var device = part.Split('.')[0].ToUpperInvariant();
                Require(device != "CON" && device != "PRN" && device != "AUX" && device != "NUL" && !(device.Length == 4 && (device.StartsWith("COM") || device.StartsWith("LPT")) && device[3] >= '1' && device[3] <= '9'), "UNSAFE_PATH", "Payload path uses a reserved device name.");
            }
        }
        private static string HashEntry(Stream stream, long expected)
        {
            using (var hash = SHA256.Create())
            {
                var buffer = new byte[65536]; long length = 0; int count;
                while ((count = stream.Read(buffer, 0, buffer.Length)) != 0)
                {
                    length = checked(length + count);
                    Require(length <= expected, "ENTRY_LENGTH", "Payload entry exceeds its manifest length.");
                    hash.TransformBlock(buffer, 0, count, buffer, 0);
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                Require(length == expected, "ENTRY_LENGTH", "Payload entry length differs from its manifest.");
                return Hex(hash.Hash);
            }
        }
        private static object Inspect(string installer, string sidecar, string expectedVersion, string expectedAppId)
        {
            // Reflection-only metadata/resource access: never Assembly.LoadFrom or installer entry-point invocation.
            var assembly = Assembly.ReflectionOnlyLoadFrom(Path.GetFullPath(installer));
            byte[] metadataBytes, manifestBytes;
            using (var stream = Resource(assembly, "Setup.Metadata.json")) metadataBytes = ReadSmall(stream, 1024 * 1024);
            using (var stream = Resource(assembly, "Setup.Manifest.json")) manifestBytes = ReadSmall(stream, 16 * 1024 * 1024);
            Require(new FileInfo(sidecar).Length <= 16 * 1024 * 1024, "RESOURCE_TOO_LARGE", "Sidecar manifest exceeds its verification limit.");
            var sidecarBytes = File.ReadAllBytes(sidecar);
            var manifestHash = Hash(manifestBytes);
            Require(manifestHash == Hash(sidecarBytes) && manifestBytes.Length == sidecarBytes.Length, "MANIFEST_BYTES_MISMATCH", "Embedded manifest bytes do not match the supplied sidecar.");
            var utf8 = new UTF8Encoding(false, true);
            var metadata = Json.Deserialize<Dictionary<string, object>>(utf8.GetString(metadataBytes));
            Require(metadata != null && metadata.ContainsKey("validation") && metadata["validation"] is bool && !(bool)metadata["validation"], "METADATA", "Expected production setup metadata.");
            Require(metadata.ContainsKey("format") && Convert.ToInt32(metadata["format"]) == 1, "METADATA", "Unsupported setup metadata format.");
            Require(metadata.ContainsKey("appId") && (string)metadata["appId"] == expectedAppId && metadata.ContainsKey("version") && (string)metadata["version"] == expectedVersion, "METADATA", "Embedded setup identity does not match source identity.");
            var manifest = Json.Deserialize<ManagedManifest>(utf8.GetString(manifestBytes));
            Require(manifest != null && manifest.format == 1 && manifest.appId == expectedAppId && manifest.version == expectedVersion && manifest.files != null && manifest.files.Length != 0, "MANIFEST", "Embedded managed manifest is invalid.");
            Require(metadata.ContainsKey("executable") && (string)metadata["executable"] == manifest.executable, "METADATA", "Setup executable identities differ.");
            var files = new Dictionary<string, ManagedFile>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in manifest.files)
            {
                Require(file != null, "MANIFEST", "Null managed-file entry."); SafeRelative(file.path);
                Require(file.bytes >= 0 && file.sha256 != null && file.sha256.Length == 64 && !files.ContainsKey(file.path), "MANIFEST", "Invalid or duplicate managed-file entry.");
                foreach (var character in file.sha256) Require(character >= '0' && character <= '9' || character >= 'a' && character <= 'f', "MANIFEST", "Invalid SHA256 text.");
                files.Add(file.path, file);
            }
            Require(files.ContainsKey(manifest.executable) && files.ContainsKey("resources/app.asar") && files.ContainsKey("resources/xuzuo-maintenance.exe"), "MANIFEST", "Required runtime files are missing.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0; long payloadBytes;
            using (var stream = Resource(assembly, "Setup.Payload.zip"))
            {
                payloadBytes = stream.Length;
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, false))
                {
                    Require(archive.Entries.Count == files.Count, "ZIP_FILE_SET", "Payload ZIP and manifest entry counts differ.");
                    foreach (var entry in archive.Entries)
                    {
                        SafeRelative(entry.FullName);
                        Require(seen.Add(entry.FullName) && files.ContainsKey(entry.FullName), "ZIP_FILE_SET", "Unexpected or duplicate ZIP entry.");
                        var expected = files[entry.FullName];
                        Require(String.Equals(entry.FullName, expected.path, StringComparison.Ordinal), "ZIP_FILE_SET", "ZIP entry spelling differs from the manifest.");
                        Require(entry.Length == expected.bytes, "ENTRY_LENGTH", "ZIP header length differs: " + entry.FullName);
                        using (var contents = entry.Open()) Require(HashEntry(contents, expected.bytes) == expected.sha256, "ENTRY_HASH", "ZIP entry SHA256 differs: " + entry.FullName);
                        total = checked(total + expected.bytes);
                    }
                }
            }
            return new { passed = true, scope = "reflection-only embedded resources and ZIP hashes; no installer entry point", appId = manifest.appId, version = manifest.version, executable = manifest.executable, manifestSha256 = manifestHash, managedFiles = files.Count, payloadEntries = seen.Count, payloadBytes = payloadBytes, uncompressedBytes = total };
        }
        public static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                Require(args.Length == 4, "ARGUMENTS", "Expected installer, sidecar, version and appId.");
                Console.WriteLine(Json.Serialize(Inspect(args[0], args[1], args[2], args[3]))); return 0;
            }
            catch (VerificationFailure error) { Console.WriteLine(Json.Serialize(new { passed = false, code = error.Code, error = error.Message })); return 1; }
            catch (Exception error) { Console.WriteLine(Json.Serialize(new { passed = false, code = "INSPECT_FAILED", error = error.Message })); return 1; }
        }
    }
}
