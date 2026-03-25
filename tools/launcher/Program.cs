using System.Diagnostics;

namespace NebulaLauncher;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var electronExe = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");

        if (!File.Exists(electronExe))
        {
            return 1;
        }

        var processStart = new ProcessStartInfo
        {
            FileName = electronExe,
            WorkingDirectory = root,
            UseShellExecute = false
        };

        processStart.ArgumentList.Add(root);
        foreach (var arg in args)
        {
            processStart.ArgumentList.Add(arg);
        }

        try
        {
            Process.Start(processStart);
            return 0;
        }
        catch
        {
            return 2;
        }
    }
}
