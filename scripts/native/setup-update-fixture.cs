using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Threading;

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
        public static int Main(string[] args)
        {
            try
            {
                var metadata = SetupJson.Resource<SetupMetadata>("Setup.Metadata.json");
                if (!metadata.validation) throw new InvalidOperationException("Only isolated validation metadata is accepted.");
                var engine = new SetupEngine(metadata);
                if (args.Length == 2 && args[0] == "install") engine.Install(args[1], false);
                else if (args.Length == 2 && args[0] == "uninstall") engine.Uninstall(args[1]);
                else throw new ArgumentException("Unknown fixture operation.");
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        }
    }
}
#endif
