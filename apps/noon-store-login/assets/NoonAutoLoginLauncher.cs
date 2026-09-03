using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

internal static class NoonAutoLoginLauncher
{
    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(true, "Local\\NoonStoreAutoLoginLauncher", out created))
        {
            if (!created) return;
            var root = AppDomain.CurrentDomain.BaseDirectory;
            var worker = Path.Combine(root, "Noon\u5e97\u94fa\u4f1a\u8bdd\u76d1\u63a7.exe");
            if (!File.Exists(worker)) return;
            var start = new ProcessStartInfo
            {
                FileName = worker,
                Arguments = "--store all --site UAE --page dashboard --background --interval-minutes 30",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var process = Process.Start(start))
            {
                if (process != null) process.WaitForExit();
            }
        }
    }
}
