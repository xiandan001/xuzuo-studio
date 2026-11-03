using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Xuzuo.Setup
{
    internal static class SetupProgram
    {
        private static Mutex operationMutex;
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetProp(IntPtr window, string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetProp(IntPtr window, string name, IntPtr value);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
        private delegate bool EnumWindow(IntPtr window, IntPtr parameter);

        [STAThread]
        public static int Main(string[] args)
        {
            SetErrorMode(0x0001 | 0x8000);
            try
            {
                var metadata = SetupJson.Resource<SetupMetadata>("Setup.Metadata.json");
                var engine = new SetupEngine(metadata);
                if (args.Contains("--self-test")) { SetupEngine.SelfTest(); WriteConsole(new { passed = true, appId = metadata.appId, version = metadata.version }); return 0; }
                if (args.Contains("--probe"))
                {
                    var registration = engine.ReadRegistration();
                    WriteConsole(new { format = 1, appId = metadata.appId, version = metadata.version, hasPayload = engine.HasPayload, validation = metadata.validation, defaultDirectory = engine.DefaultDirectory, installedDirectory = registration == null ? "" : registration.Root, installedVersion = registration == null ? "" : registration.Version, machineInstallation = registration != null && registration.Machine }); return 0;
                }
                var uninstall = !engine.HasPayload || args.Contains("--uninstall");
                var root = Argument(args, "--root") ?? engine.DefaultDirectory;
                if (uninstall && !OwnedTemporaryCopy(metadata, root))
                {
                    if (!engine.HasRecoverableOperation(root)) engine.ValidateRegisteredRoot(root);
                    StartTemporaryMaintenance(metadata, root); return 0;
                }
                bool created;
                operationMutex = new Mutex(true, "Local\\Xuzuo.Setup." + metadata.installGuid, out created);
                if (!created) { BringExisting(metadata.installGuid); operationMutex.Dispose(); operationMutex = null; return 3; }
                try { return RunWindow(engine, uninstall, root); }
                finally { operationMutex.ReleaseMutex(); operationMutex.Dispose(); operationMutex = null; }
            }
            catch (Exception error)
            {
                if (args.Contains("--probe") || args.Contains("--self-test")) { WriteConsole(new { passed = false, error = PublicError(error) }); return 1; }
                ShowEmergency(PublicError(error)); return 1;
            }
        }
        private static string Argument(string[] args, string name)
        {
            var index = Array.IndexOf(args, name);
            if (index < 0) return null;
            if (index + 1 >= args.Length || String.IsNullOrWhiteSpace(args[index + 1])) throw new InvalidDataException("启动参数不完整。");
            return args[index + 1];
        }
        private static string PublicError(Exception error)
        {
            var baseError = error is System.Reflection.TargetInvocationException && error.InnerException != null ? error.InnerException : error;
            if (baseError is UnauthorizedAccessException) return "没有权限写入此位置。请选择个人目录，或关闭占用文件的程序后重试。";
            return (baseError.Message ?? "操作未完成，现有文件保留。").Length > 2000 ? baseError.Message.Substring(0, 2000) : baseError.Message;
        }
        private static int RunWindow(SetupEngine engine, bool uninstall, string root)
        {
            var metadata = engine.Metadata; var registration = engine.ReadRegistration();
            var options = new SetupOptions { Title = metadata.productName, Version = metadata.version, InstalledVersion = registration == null ? "" : registration.Version, DefaultDirectory = root, Uninstall = uninstall, AllowDirectoryChange = !uninstall && registration == null };
            var application = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            var window = new SetupWindow(options); var busy = false; string installed = null;
            if (metadata.validation && Environment.GetEnvironmentVariable("XUZUO_SETUP_QA_HIDDEN") == "1")
            {
                window.WindowStartupLocation = WindowStartupLocation.Manual; window.Left = -20000; window.Top = -20000; window.ShowInTaskbar = false; window.ShowActivated = false;
            }
            application.DispatcherUnhandledException += delegate(object sender, System.Windows.Threading.DispatcherUnhandledExceptionEventArgs error) { error.Handled = true; if (busy) window.SetProgress("正在安全完成操作", "界面遇到问题，文件操作仍在收尾，请稍候。", null); else window.SetError("界面操作未完成", PublicError(error.Exception)); };
            engine.Progress = delegate(string stage, string detail, double? percent) { window.SetProgress(stage, detail, percent); };
            window.LoadLocationsAsync = delegate { return Task.Run<IList<SetupLocation>>(() => engine.LoadLocations()); };
            window.ListDirectoriesAsync = delegate(string directory) { return Task.Run(() => engine.ListDirectories(directory)); };
            window.CreateFolderAsync = delegate(string directory, string name) { return Task.Run(() => engine.CreateFolder(directory, name)); };
            window.SourceInitialized += delegate { SetProp(new System.Windows.Interop.WindowInteropHelper(window).Handle, "Xuzuo.Setup." + metadata.installGuid, new IntPtr(1)); };
            window.StartInstallRequested += async delegate(string directory, bool desktop, bool launch)
            {
                if (busy) return; busy = true;
                try
                {
                    window.SetOperationState("正在准备安装", "正在验证安装包和目录，创作资料不会被删除。");
                    var result = await Task.Run(() => engine.Install(directory, desktop)); installed = result.Root;
                    window.SetSuccess("安装完成", result.Detail, !metadata.validation);
                    if (launch && !metadata.validation) try { engine.Launch(installed); } catch (Exception error) { window.SetError("安装已完成，应用尚未打开", PublicError(error)); }
                }
                catch (Exception error) { window.SetError("安装未完成", PublicError(error)); }
                finally { busy = false; }
            };
            window.StartUninstallRequested += async delegate
            {
                if (busy) return; busy = true;
                try
                {
                    window.SetOperationState("正在准备卸载", "只移除应用安装文件，工作区、历史费用与密钥资料保留。");
                    var result = await Task.Run(() => engine.Uninstall(root)); window.SetSuccess("卸载完成", result.Detail, false);
                }
                catch (Exception error) { window.SetError("卸载未完成", PublicError(error)); }
                finally { busy = false; }
            };
            window.LaunchRequested += delegate
            {
                if (metadata.validation || installed == null) return;
                try { engine.Launch(installed); } catch (Exception error) { window.SetError("应用尚未打开", PublicError(error)); }
            };
            return application.Run(window);
        }
        private static string TemporaryBase(SetupMetadata metadata)
        {
            return metadata.validation ? Path.Combine(Path.GetFullPath(metadata.validationRoot), "temporary-maintenance", metadata.installGuid) : Path.Combine(Path.GetTempPath(), "XuzuoSetup", metadata.installGuid);
        }
        private static bool Inside(string root, string value) { return Path.GetFullPath(value).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); }
        private static void NoLinks(string value)
        {
            var path = Path.GetFullPath(value); var root = Path.GetPathRoot(path); var current = root;
            foreach (var item in path.Substring(root.Length).Split(new[] { Path.DirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
            {
                current = Path.Combine(current, item);
                FileAttributes attributes;
                try { attributes = File.GetAttributes(current); } catch (FileNotFoundException) { break; } catch (DirectoryNotFoundException) { break; }
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("临时维护路径包含链接，操作已停止。");
            }
        }
        private static string Sha(string path)
        {
            using (var input = File.OpenRead(path)) using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
        private static bool OwnedTemporaryCopy(SetupMetadata metadata, string root)
        {
            var executable = Assembly.GetExecutingAssembly().Location; var directory = Path.GetDirectoryName(executable);
            if (!Inside(TemporaryBase(metadata), executable)) return false;
            NoLinks(directory);
            var marker = SetupJson.File<Dictionary<string, object>>(Path.Combine(directory, "maintenance-session.json"));
            if (Convert.ToInt32(marker["format"]) != 1 || Convert.ToString(marker["appId"]) != metadata.appId || Convert.ToString(marker["installGuid"]) != metadata.installGuid || !String.Equals(Path.GetFullPath(Convert.ToString(marker["root"])), Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase) || Convert.ToString(marker["sha256"]) != Sha(executable)) throw new InvalidDataException("临时维护程序身份不匹配。");
            return true;
        }
        private static void StartTemporaryMaintenance(SetupMetadata metadata, string root)
        {
            var source = Assembly.GetExecutingAssembly().Location; var directory = Path.Combine(TemporaryBase(metadata), Guid.NewGuid().ToString("N"));
            NoLinks(directory); Directory.CreateDirectory(directory);
            var target = Path.Combine(directory, "xuzuo-maintenance.exe"); File.Copy(source, target, false);
            SetupJson.Write(Path.Combine(directory, "maintenance-session.json"), new { format = 1, appId = metadata.appId, installGuid = metadata.installGuid, root = Path.GetFullPath(root), sha256 = Sha(target) });
            Process.Start(new ProcessStartInfo { FileName = target, Arguments = "--uninstall --root " + SetupEngine.Quote(root), WorkingDirectory = directory, UseShellExecute = false });
        }
        private static void BringExisting(string guid)
        {
            EnumWindows(delegate(IntPtr window, IntPtr parameter) { if (GetProp(window, "Xuzuo.Setup." + guid) != IntPtr.Zero) { ShowWindow(window, 9); SetForegroundWindow(window); return false; } return true; }, IntPtr.Zero);
        }
        private static void WriteConsole(object value)
        {
            using (var writer = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false))) { writer.Write(SetupJson.Serializer().Serialize(value)); writer.Write('\n'); }
        }
        private static void ShowEmergency(string detail)
        {
            var app = Application.Current ?? new Application();
            var window = new Window { Title = "序作工作台", Width = 580, Height = 400, MinWidth = 450, WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterScreen, Background = Brushes.White };
            var grid = new Grid { Margin = new Thickness(28) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var title = new TextBlock { Text = "安装窗口暂不可用", FontSize = 22, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(32, 33, 40)) };
            title.MouseLeftButtonDown += delegate { window.DragMove(); }; grid.Children.Add(title);
            var scroll = new ScrollViewer { Margin = new Thickness(0, 16, 0, 20), VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, Focusable = true, Content = new TextBlock { Text = detail, FontSize = 15, TextWrapping = TextWrapping.Wrap } }; Grid.SetRow(scroll, 1); grid.Children.Add(scroll);
            var button = new Button { Content = "关闭", Height = 40, Width = 100, HorizontalAlignment = HorizontalAlignment.Right, Background = new SolidColorBrush(Color.FromRgb(104, 83, 235)), Foreground = Brushes.White, BorderThickness = new Thickness(0), FocusVisualStyle = null, IsDefault = true, IsCancel = true };
            var template = new ControlTemplate(typeof(Button)); var border = new FrameworkElementFactory(typeof(Border)); border.SetValue(Border.BackgroundProperty, button.Background); border.SetValue(Border.CornerRadiusProperty, new CornerRadius(8)); var presenter = new FrameworkElementFactory(typeof(ContentPresenter)); presenter.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center); presenter.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center); border.AppendChild(presenter); template.VisualTree = border; button.Template = template;
            button.Click += delegate { window.Close(); }; Grid.SetRow(button, 2); grid.Children.Add(button); window.Content = grid; app.ShutdownMode = ShutdownMode.OnMainWindowClose; app.MainWindow = window; app.Run(window);
        }
    }
}
