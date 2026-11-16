using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace Xuzuo.Setup
{
    internal static class SetupDirectoryMoveFixture
    {
        private const string Owner = ".move-fixture-owner";
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

        private sealed class LockedSource : IDisposable
        {
            private readonly FileStream file;
            private readonly SafeFileHandle directory;
            internal LockedSource(string source)
            {
                file = new FileStream(Path.Combine(source, "application.txt"), FileMode.Open, FileAccess.Read, FileShare.Read);
                directory = CreateFile(source, 0x80000000U, (uint)FileShare.Read, IntPtr.Zero, 3, 0x02000000U, IntPtr.Zero);
                if (directory.IsInvalid) { var error = Marshal.GetLastWin32Error(); directory.Dispose(); file.Dispose(); throw new Win32Exception(error, "Could not hold the owned directory without delete sharing."); }
            }
            public void Dispose() { directory.Dispose(); file.Dispose(); }
        }

        private static void Check(bool value, string message) { if (!value) throw new InvalidDataException(message); }
        private static string Hash(string filename)
        {
            using (var sha = SHA256.Create()) using (var stream = new FileStream(filename, FileMode.Open, FileAccess.Read, FileShare.Read)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
        private static void NoReparse(string path)
        {
            for (var cursor = Path.GetFullPath(path); cursor != null; cursor = Path.GetDirectoryName(cursor))
            {
                try { Check((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) == 0, "Fixture path became a reparse point."); }
                catch (FileNotFoundException) { } catch (DirectoryNotFoundException) { }
            }
        }
        private static string Prepare(string group, out string destination, out string nonce)
        {
            Directory.CreateDirectory(group); var source = Path.Combine(group, "source"); destination = Path.Combine(group, "destination"); nonce = Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(source); File.WriteAllText(Path.Combine(source, Owner), nonce);
            File.WriteAllText(Path.Combine(source, "application.txt"), "Synthetic old application, not an installed program.\n");
            File.WriteAllText(Path.Combine(source, "fees.json"), "{\"synthetic\":true,\"costCents\":123,\"refunded\":false}\n"); return source;
        }
        private static void Validate(string group, string source, string destination, string nonce)
        {
            Check(Path.GetDirectoryName(source) == group && Path.GetDirectoryName(destination) == group, "Fixture move escaped its owned parent.");
            NoReparse(source); NoReparse(destination);
            Check(Directory.Exists(source) && File.ReadAllText(Path.Combine(source, Owner)) == nonce, "Owned source changed.");
            Check(!Directory.Exists(destination) && !File.Exists(destination), "Destination is already occupied.");
        }

        private static object ReleasedLock(string root)
        {
            var group = Path.Combine(root, "released-lock"); string destination, nonce; var source = Prepare(group, out destination, out nonce);
            string applicationHash = Hash(Path.Combine(source, "application.txt")), feesHash = Hash(Path.Combine(source, "fees.json"));
            var held = new LockedSource(source); var firstRetry = new ManualResetEvent(false); var retries = 0; var validations = 0; var released = false; Exception releaseError = null;
            var release = new Thread(delegate()
            {
                try { Check(firstRetry.WaitOne(5000), "The real lock did not cause a retry."); Thread.Sleep(350); held.Dispose(); released = true; }
                catch (Exception error) { releaseError = error; }
                finally { held.Dispose(); }
            }); release.IsBackground = true; release.Start(); var clock = Stopwatch.StartNew();
            try { SetupDirectoryMove.Move(source, destination, delegate { validations++; Validate(group, source, destination, nonce); }, delegate { retries++; firstRetry.Set(); }); }
            finally { firstRetry.Set(); Check(release.Join(5000), "Owned release thread did not finish."); held.Dispose(); firstRetry.Dispose(); }
            if (releaseError != null) throw releaseError;
            Check(released && retries > 0 && validations > 1, "Retry was not demonstrated with a real Windows lock.");
            Check(!Directory.Exists(source) && Directory.Exists(destination), "Owned source was not switched.");
            Check(Hash(Path.Combine(destination, "application.txt")) == applicationHash && Hash(Path.Combine(destination, "fees.json")) == feesHash, "Moving the released source changed its data.");
            return new { name = "delayed-lock-release", passed = true, retries = retries, validations = validations, elapsedMs = clock.ElapsedMilliseconds, realFileShareRead = true, directoryDeleteSharingDenied = true, applicationSha256 = applicationHash, feesSha256 = feesHash, observedApplicationSha256 = Hash(Path.Combine(destination, "application.txt")), observedFeesSha256 = Hash(Path.Combine(destination, "fees.json")), feesPreserved = true };
        }

        private static object PermanentLock(string root)
        {
            var group = Path.Combine(root, "permanent-lock"); string destination, nonce; var source = Prepare(group, out destination, out nonce);
            string applicationHash = Hash(Path.Combine(source, "application.txt")), feesHash = Hash(Path.Combine(source, "fees.json"));
            var retries = 0; var validations = 0; var rejected = false; var clock = Stopwatch.StartNew();
            using (var held = new LockedSource(source))
            {
                try { SetupDirectoryMove.Move(source, destination, delegate { validations++; Validate(group, source, destination, nonce); }, delegate { retries++; }); }
                catch (IOException) { rejected = true; } catch (UnauthorizedAccessException) { rejected = true; }
                Check(rejected && retries > 0 && validations > 1, "Permanent lock did not fail after bounded retries.");
                Check(clock.ElapsedMilliseconds >= 2500 && clock.ElapsedMilliseconds <= SetupDirectoryMove.MaximumMilliseconds + 500, "Permanent lock exceeded its bounded retry window.");
                Check(Directory.Exists(source) && !Directory.Exists(destination) && !File.Exists(destination), "Permanent lock changed the source or destination.");
                Check(File.ReadAllText(Path.Combine(source, Owner)) == nonce && Hash(Path.Combine(source, "application.txt")) == applicationHash && Hash(Path.Combine(source, "fees.json")) == feesHash, "Permanent lock changed owned files or fees.");
            }
            return new { name = "permanent-lock-preserves-source", passed = true, retries = retries, validations = validations, elapsedMs = clock.ElapsedMilliseconds, realFileShareRead = true, directoryDeleteSharingDenied = true, originalDirectoryPreserved = true, applicationSha256 = applicationHash, feesSha256 = feesHash, observedApplicationSha256 = Hash(Path.Combine(source, "application.txt")), observedFeesSha256 = Hash(Path.Combine(source, "fees.json")), feesPreserved = true };
        }

        private static object ValidationFailure(string root)
        {
            var group = Path.Combine(root, "validation-failure"); string destination, nonce; var source = Prepare(group, out destination, out nonce);
            Directory.CreateDirectory(destination); var unknown = Path.Combine(destination, "unknown-customer-note.txt"); File.WriteAllText(unknown, "Synthetic unknown destination; must not be overwritten.\n");
            string applicationHash = Hash(Path.Combine(source, "application.txt")), feesHash = Hash(Path.Combine(source, "fees.json")), unknownHash = Hash(unknown);
            var retries = 0; var validations = 0; var rejected = false; var clock = Stopwatch.StartNew();
            try { SetupDirectoryMove.Move(source, destination, delegate { validations++; Validate(group, source, destination, nonce); }, delegate { retries++; }); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected && validations == 1 && retries == 0, "Validation rejection was retried or ignored.");
            Check(Directory.Exists(source) && Directory.Exists(destination) && Hash(Path.Combine(source, "application.txt")) == applicationHash && Hash(Path.Combine(source, "fees.json")) == feesHash && Hash(unknown) == unknownHash, "Validation rejection changed source, unknown destination or fees.");
            return new { name = "validation-failure-no-retry", passed = true, retries = retries, validations = validations, elapsedMs = clock.ElapsedMilliseconds, originalDirectoryPreserved = true, applicationSha256 = applicationHash, feesSha256 = feesHash, unknownDestinationSha256 = unknownHash, observedApplicationSha256 = Hash(Path.Combine(source, "application.txt")), observedFeesSha256 = Hash(Path.Combine(source, "fees.json")), observedUnknownDestinationSha256 = Hash(unknown), feesPreserved = true };
        }

        public static int Main(string[] args)
        {
            try
            {
                Check(Environment.OSVersion.Platform == PlatformID.Win32NT && args.Length == 1 && Path.IsPathRooted(args[0]), "Expected one owned absolute Windows fixture path.");
                var root = Path.GetFullPath(args[0]); NoReparse(root);
                Check(Directory.Exists(root) && !File.Exists(root) && Directory.GetFileSystemEntries(root).Length == 0, "Expected an existing empty owned fixture directory; previous evidence must be retained.");
                File.WriteAllText(Path.Combine(root, Owner), Guid.NewGuid().ToString("N"));
                var cases = new[] { ReleasedLock(root), PermanentLock(root), ValidationFailure(root) };
                Console.WriteLine(new JavaScriptSerializer().Serialize(new { passed = true, directory = root, maximumRetryMilliseconds = SetupDirectoryMove.MaximumMilliseconds, cases = cases, applicationStarted = false, installed = false, registryModified = false, providerCalls = 0 })); return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
        }
    }
}
