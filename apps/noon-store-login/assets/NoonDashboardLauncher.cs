using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class NoonDashboardLauncher
{
    private static readonly string[] Projects =
    {
        "PRJ42958", "PRJ55651", "PRJ61683", "PRJ65553", "PRJ75299", "PRJ363826"
    };

    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(true, "Local\\NoonSixStoreDashboardLauncher", out created))
        {
            if (!created) return;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var form = new Form
            {
                Text = "Noon \u516d\u5e97\u770b\u677f",
                ClientSize = new Size(420, 130),
                StartPosition = FormStartPosition.CenterScreen,
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false,
                ShowInTaskbar = true
            };
            var label = new Label
            {
                AutoSize = false,
                Location = new Point(24, 24),
                Size = new Size(372, 38),
                Text = "\u6b63\u5728\u786e\u8ba4\u516d\u4e2a\u5e97\u94fa\u7684\u767b\u5f55\u72b6\u6001...",
                Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Regular)
            };
            var progress = new ProgressBar
            {
                Location = new Point(24, 76),
                Size = new Size(372, 18),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 28
            };
            form.Controls.Add(label);
            form.Controls.Add(progress);

            form.Shown += delegate
            {
                var scheduler = TaskScheduler.FromCurrentSynchronizationContext();
                Task.Factory.StartNew(OpenDashboards).ContinueWith(delegate(Task task)
                {
                    if (task.IsFaulted)
                    {
                        var message = task.Exception == null ? "Unknown error" : task.Exception.GetBaseException().Message;
                        MessageBox.Show(form, message, "Noon \u516d\u5e97\u770b\u677f", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                    form.Close();
                }, scheduler);
            };
            Application.Run(form);
        }
    }

    private static void OpenDashboards()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var worker = Path.Combine(root, "Noon\u5e97\u94fa\u4f1a\u8bdd\u76d1\u63a7.exe");
        if (!File.Exists(worker)) throw new FileNotFoundException("Noon store login worker is missing.", worker);
        using (var process = Process.Start(new ProcessStartInfo
        {
            FileName = worker,
            Arguments = "--store all --site UAE --page dashboard --background --interval-minutes 30",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        }))
        {
            if (process != null) process.WaitForExit();
        }

        var chrome = FindChrome();
        for (var index = 0; index < Projects.Length; index++)
        {
            var partner = Projects[index].Substring(3);
            var url = "https://noon-store.noon.partners/en/STR" + partner + "-NAE/home?project=" + Projects[index] + "&tabs=dashboard";
            Process.Start(new ProcessStartInfo
            {
                FileName = chrome,
                Arguments = "--profile-directory=\"Profile " + (index + 1) + "\" --new-window \"" + url + "\"",
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal
            });
            Thread.Sleep(350);
        }
    }

    private static string FindChrome()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
        };
        foreach (var candidate in candidates) if (File.Exists(candidate)) return candidate;
        throw new FileNotFoundException("Google Chrome is not installed.");
    }
}
