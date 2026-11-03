using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

internal static class WindowsDriveInfo
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetLogicalDrives();

    [DllImport("kernel32.dll", EntryPoint = "GetDriveTypeW", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveType(string root);

    [DllImport("kernel32.dll", EntryPoint = "QueryDosDeviceW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint QueryDosDevice(string name, [Out] char[] target, int length);

    private static bool IsLocalDevice(char letter, uint seen)
    {
        uint bit = 1u << (letter - 'A');
        if ((seen & bit) != 0) return false;
        char[] buffer = new char[4096];
        uint length = QueryDosDevice(letter + ":", buffer, buffer.Length);
        if (length == 0) return false;
        int end = Array.IndexOf(buffer, '\0');
        string target = new string(buffer, 0, end < 0 ? (int)length : end);
        if (target.IndexOf("Lanman", StringComparison.OrdinalIgnoreCase) >= 0 ||
            target.IndexOf("\\Mup", StringComparison.OrdinalIgnoreCase) >= 0 ||
            target.IndexOf("WebDav", StringComparison.OrdinalIgnoreCase) >= 0 ||
            target.StartsWith(@"\??\UNC\", StringComparison.OrdinalIgnoreCase) ||
            target.StartsWith(@"\\", StringComparison.OrdinalIgnoreCase)) return false;
        if (target.StartsWith(@"\??\", StringComparison.OrdinalIgnoreCase) && target.Length >= 6 && target[5] == ':')
        {
            char source = Char.ToUpperInvariant(target[4]);
            return source >= 'A' && source <= 'Z' && IsLocalDevice(source, seen | bit);
        }
        return target.StartsWith(@"\Device\", StringComparison.OrdinalIgnoreCase);
    }

    private static int Main()
    {
        try
        {
            uint available = GetLogicalDrives();
            if (available == 0) throw new InvalidOperationException("Drive bitmap unavailable.");
            List<string> drives = new List<string>();
            for (int index = 0; index < 26; index++)
            {
                if ((available & (1u << index)) == 0) continue;
                char letter = (char)('A' + index);
                if (!IsLocalDevice(letter, 0)) continue;
                uint type = GetDriveType(letter + @":\");
                if (type == 2 || type == 3) drives.Add("{\"letter\":\"" + letter + "\",\"type\":" + type + "}");
            }
            if (drives.Count == 0) throw new InvalidOperationException("Local drives unavailable.");
            string json = "{\"version\":1,\"drives\":[" + String.Join(",", drives.ToArray()) + "]}\n";
            byte[] bytes = new UTF8Encoding(false).GetBytes(json);
            using (System.IO.Stream output = Console.OpenStandardOutput()) output.Write(bytes, 0, bytes.Length);
            return 0;
        }
        catch
        {
            byte[] bytes = Encoding.ASCII.GetBytes("Local drive discovery failed.\n");
            using (System.IO.Stream output = Console.OpenStandardError()) output.Write(bytes, 0, bytes.Length);
            return 1;
        }
    }
}
