using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;

namespace Xuzuo.Setup
{
    public sealed class SetupOptions
    {
        public string Version = "";
        public string InstalledVersion = "";
        public string DefaultDirectory = "";
        public string Title = "序作工作台";
        public string IconPath = "";
        public bool AllowDirectoryChange = true;
        public bool Uninstall;
    }
    public sealed class SetupLocation { public string Name { get; set; } public string Path { get; set; } public bool IsDrive { get; set; } }
    public sealed class SetupDirectory { public string Name { get; set; } public string Path { get; set; } }
    public sealed class SetupDirectoryListing
    {
        public string Path { get; set; }
        public string ParentPath { get; set; }
        public IList<SetupDirectory> Directories { get; set; }
    }

    public sealed class SetupWindow : Window
    {
        public event Action<string, bool, bool> StartInstallRequested;
        public event Action StartUninstallRequested;
        public event Action LaunchRequested;
        public Func<Task<IList<SetupLocation>>> LoadLocationsAsync;
        public Func<string, Task<SetupDirectoryListing>> ListDirectoriesAsync;
        public Func<string, string, Task<SetupDirectoryListing>> CreateFolderAsync;
        private readonly SetupOptions options;
        private readonly FrameworkElement surface;
        private readonly List<string> history = new List<string>();
        private int historyIndex = -1, directoryGeneration, directoryCount;
        private string currentDirectory = "", parentDirectory;
        private bool busy, pickerOpen, pickerBusy, completed, failed, allowedClose, confirmBusy;
        private double? progress;

        public SetupWindow(SetupOptions value)
        {
            if (value == null) throw new ArgumentNullException("value");
            options = value;
            Title = options.Title + (options.Uninstall ? " · 卸载" : " · 安装");
            Width = Math.Min(860, Math.Max(640, SystemParameters.WorkArea.Width - 32));
            Height = Math.Min(640, Math.Max(480, SystemParameters.WorkArea.Height - 32));
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true; Background = Brushes.Transparent;
            FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI");
            SnapsToDevicePixels = true; UseLayoutRounding = true;
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("Setup.Ui.xaml") ?? Assembly.GetExecutingAssembly().GetManifestResourceStream("Xuzuo.Setup.Window.xaml"))
            {
                if (input == null) throw new InvalidOperationException("安装界面资源缺失，请重新获取完整安装包。");
                surface = (FrameworkElement)XamlReader.Load(input);
            }
            Content = surface;
            BindEvents(); SetIdle();
            Loaded += delegate { Control<Button>("PrimaryButton").Focus(); };
            Closing += OnClosing;
            PreviewKeyDown += OnKeyDown;
        }
        private T Control<T>(string name) where T : FrameworkElement { return (T)surface.FindName(name); }
        private void Ui(Action action) { if (Dispatcher.CheckAccess()) action(); else Dispatcher.BeginInvoke(action); }
        private void Text(string name, string text) { Control<TextBlock>(name).Text = text ?? ""; }
        private void Visible(string name, bool visible) { Control<FrameworkElement>(name).Visibility = visible ? Visibility.Visible : Visibility.Collapsed; if (name == "ConfirmOverlay") Control<Border>("MainSurface").IsEnabled = !visible; }
        private void Page(string name) { foreach (string item in new[] { "StartPage", "OperationPage", "PickerPage" }) Visible(item, item == name); }
        private void BindEvents()
        {
            Control<FrameworkElement>("TitleDrag").MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) { if (e.OriginalSource is TextBlock || e.OriginalSource == sender) { try { DragMove(); } catch (InvalidOperationException) { } } };
            Control<Button>("CloseButton").Click += delegate { RequestClose(); };
            Control<Button>("MinimizeButton").Click += delegate { WindowState = WindowState.Minimized; };
            Control<Button>("PrimaryButton").Click += delegate { Primary(); };
            Control<Button>("SecondaryButton").Click += delegate { if (busy) WindowState = WindowState.Minimized; else if (pickerOpen) ClosePicker(); else RequestClose(); };
            Control<Button>("ChangeDirectoryButton").Click += async delegate { await OpenPicker(); };
            Control<Button>("GoButton").Click += async delegate { await Navigate(Control<TextBox>("PickerPath").Text, true); };
            Control<TextBox>("PickerPath").KeyDown += async delegate(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; await Navigate(Control<TextBox>("PickerPath").Text, true); } };
            Control<Button>("BackButton").Click += async delegate { await GoBack(); };
            Control<Button>("UpButton").Click += async delegate { if (!String.IsNullOrEmpty(parentDirectory)) await Navigate(parentDirectory, true); };
            Control<Button>("NewFolderButton").Click += delegate { if (!pickerBusy) { Visible("NewFolderForm", true); Control<TextBox>("NewFolderName").Focus(); Control<TextBox>("NewFolderName").SelectAll(); } };
            Control<Button>("CancelNewFolderButton").Click += delegate { Visible("NewFolderForm", false); Control<Button>("NewFolderButton").Focus(); };
            Control<Button>("CreateFolderButton").Click += async delegate { await CreateFolder(); };
            Control<TextBox>("NewFolderName").KeyDown += async delegate(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; await CreateFolder(); } };
            Control<TextBox>("NewFolderName").TextChanged += delegate { if (!pickerBusy) Text("PickerError", ""); };
            Control<ListBox>("Directories").SelectionChanged += delegate { UpdateTarget(); };
            Control<ListBox>("Directories").MouseDoubleClick += async delegate { await EnterSelected(); };
            Control<ListBox>("Directories").KeyDown += async delegate(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; await EnterSelected(); } };
            Control<Button>("ConfirmCancel").Click += delegate { Visible("ConfirmOverlay", false); Control<Button>("PrimaryButton").Focus(); };
            Control<Button>("ConfirmAccept").Click += delegate { if (confirmBusy) { Visible("ConfirmOverlay", false); WindowState = WindowState.Minimized; } else { allowedClose = true; Close(); } };
            Control<Border>("ProgressTrack").SizeChanged += delegate { DrawProgress(); };
        }
        public void SetIdle()
        {
            Ui(delegate {
                busy = false; pickerOpen = false; pickerBusy = false; completed = false; failed = false; progress = null;
                Page("StartPage"); Visible("ConfirmOverlay", false); Visible("DirectorySection", !options.Uninstall); Visible("InstallOptions", !options.Uninstall); Visible("StartError", false);
                Control<TextBox>("InstallDirectory").Text = options.DefaultDirectory ?? "";
                Control<Button>("ChangeDirectoryButton").IsEnabled = options.AllowDirectoryChange;
                Text("DirectoryNote", options.AllowDirectoryChange ? "默认安装到你的个人目录，无需管理员权限。" : "更新会沿用原安装位置，项目、作品与本地密钥保持保留。" );
                Text("Caption", Title); Text("StartEyebrow", options.Uninstall ? "妥善保留，随时回来。" : "XUZUO STUDIO");
                Text("StartHeading", options.Uninstall ? "卸载序作工作台" : String.IsNullOrEmpty(options.InstalledVersion) ? "准备好，开始创作。" : "为创作，更新一步。" );
                Text("StartDescription", options.Uninstall ? "仅移除应用程序与快捷方式，你的创作资料会保留。" : "本地创作、编辑与交付，在一个工作台里完成。" );
                Text("VersionHeading", "序作工作台 " + options.Version);
                Text("VersionDetail", options.Uninstall ? "当前应用位置：" + options.DefaultDirectory : String.IsNullOrEmpty(options.InstalledVersion) ? "安装到当前 Windows 用户，无需管理员权限。" : "已安装 " + options.InstalledVersion + "，将保留资料并更新应用。" );
                Text("PreserveText", options.Uninstall ? "保留项目与作品文件、历史费用、提示词和本地加密密钥。重新安装后可继续使用。" : "项目、作品文件、费用记录和本地加密密钥独立保存；更新不会主动删除这些资料。" );
                Text("FooterNote", "本地处理 · 创作资料独立保存");
                Control<Button>("PrimaryButton").Content = options.Uninstall ? "确认卸载应用" : String.IsNullOrEmpty(options.InstalledVersion) ? "开始安装" : "开始更新";
                Control<Button>("PrimaryButton").IsEnabled = true;
                Control<Button>("SecondaryButton").Content = options.Uninstall ? "保留应用" : "暂不安装"; Control<Button>("SecondaryButton").IsEnabled = true;
            });
        }
        public void SetOperationState(string stage, string detail) { SetProgress(stage, detail, null); }
        public void SetProgress(string stage, string detail, double? percent)
        {
            Ui(delegate {
                busy = true; pickerOpen = false; completed = false; failed = false; Page("OperationPage");
                progress = percent.HasValue && !Double.IsNaN(percent.Value) && !Double.IsInfinity(percent.Value) ? Math.Max(0, Math.Min(100, percent.Value)) : (double?)null;
                Text("StateSymbol", options.Uninstall ? "−" : "↓"); Text("OperationHeading", stage); Text("OperationDetail", detail);
                Visible("ProgressTrack", progress.HasValue); Text("ProgressText", progress.HasValue ? progress.Value.ToString("0") + "%" : "正在处理本地文件，请稍候。" );
                Visible("ErrorDetail", false); Control<Button>("PrimaryButton").Content = "正在处理…"; Control<Button>("PrimaryButton").IsEnabled = false;
                Control<Button>("SecondaryButton").Content = "最小化"; Control<Button>("SecondaryButton").IsEnabled = true;
                Text("FooterNote", "请保持窗口打开，当前操作不会删除创作资料。"); DrawProgress();
            });
        }
        public void SetSuccess(string title, string detail, bool canLaunch)
        {
            Ui(delegate {
                busy = false; completed = true; failed = false; pickerOpen = false; Page("OperationPage"); Visible("ConfirmOverlay", false);
                Text("StateSymbol", "✓"); Text("OperationHeading", title); Text("OperationDetail", detail); Visible("ProgressTrack", false); Visible("ErrorDetail", false);
                Text("ProgressText", options.Uninstall ? "创作资料已保留在原位置。" : "应用已就绪，可以开始创作。" );
                Control<Button>("PrimaryButton").Content = canLaunch && !options.Uninstall ? "打开序作工作台" : "完成"; Control<Button>("PrimaryButton").Tag = canLaunch && !options.Uninstall;
                Control<Button>("PrimaryButton").IsEnabled = true; Control<Button>("SecondaryButton").Content = "关闭"; Control<Button>("SecondaryButton").IsEnabled = true;
                Text("FooterNote", options.Uninstall ? "应用已移除 · 作品与密钥保留" : "安装完成 · 作品资料保持独立");
                Control<Button>("PrimaryButton").Focus();
            });
        }
        public void SetError(string title, string detail)
        {
            Ui(delegate {
                busy = false; completed = false; failed = true; pickerOpen = false; Page("OperationPage"); Visible("ConfirmOverlay", false);
                Text("StateSymbol", "!"); Text("OperationHeading", title); Text("OperationDetail", "当前操作未完成。请查看原因，原有创作资料保持保留。");
                Control<TextBox>("ErrorDetail").Text = detail ?? "请稍后重试。"; Visible("ErrorDetail", true); Visible("ProgressTrack", false); Text("ProgressText", "");
                Control<Button>("PrimaryButton").Content = "返回并重试"; Control<Button>("PrimaryButton").IsEnabled = true;
                Control<Button>("SecondaryButton").Content = "关闭"; Control<Button>("SecondaryButton").IsEnabled = true;
                Text("FooterNote", "遇到问题时不会自动删除你的作品和密钥。");
            });
        }
        public bool LaunchAfter { get { return Control<CheckBox>("LaunchAfter").IsChecked == true; } }
        public bool DesktopShortcut { get { return Control<CheckBox>("DesktopShortcut").IsChecked == true; } }
        private void DrawProgress()
        {
            double width = Control<Border>("ProgressTrack").ActualWidth;
            Control<Border>("ProgressFill").Width = Math.Max(0, width * (progress ?? 0) / 100);
        }
        private void Primary()
        {
            if (pickerOpen) { if (!pickerBusy) { SetupDirectory selected = Control<ListBox>("Directories").SelectedItem as SetupDirectory; string target = selected == null ? currentDirectory : selected.Path; if (!String.IsNullOrEmpty(target)) { options.DefaultDirectory = target; Control<TextBox>("InstallDirectory").Text = target; ClosePicker(); } } return; }
            if (busy) return;
            if (completed) { bool launch = Control<Button>("PrimaryButton").Tag is bool && (bool)Control<Button>("PrimaryButton").Tag; if (launch && LaunchRequested != null) { try { LaunchRequested(); } catch (Exception error) { SetError("应用暂时无法打开", PublicMessage(error)); } } else { allowedClose = true; Close(); } return; }
            if (failed) { SetIdle(); return; }
            if (!options.Uninstall && String.IsNullOrWhiteSpace(Control<TextBox>("InstallDirectory").Text)) { Text("StartError", "请选择安装文件夹。"); Visible("StartError", true); return; }
            if (options.Uninstall) { if (StartUninstallRequested == null) { SetError("卸载尚未开始", "卸载处理器未就绪，请重新启动维护程序。"); return; } SetOperationState("准备卸载", "正在核对本地安装，作品与密钥会保留。"); try { StartUninstallRequested(); } catch (Exception error) { SetError("卸载尚未完成", PublicMessage(error)); } }
            else { if (StartInstallRequested == null) { SetError("安装尚未开始", "安装处理器未就绪，请重新获取完整安装包。"); return; } string target = Control<TextBox>("InstallDirectory").Text; bool shortcut = DesktopShortcut, launch = LaunchAfter; SetOperationState("准备安装", "正在核对安装位置与本地文件。"); try { StartInstallRequested(target, shortcut, launch); } catch (Exception error) { SetError("安装尚未完成", PublicMessage(error)); } }
        }
        private async Task OpenPicker()
        {
            if (busy || !options.AllowDirectoryChange) return;
            pickerOpen = true; Page("PickerPage"); Visible("NewFolderForm", false); Text("PickerError", "");
            Control<Button>("SecondaryButton").Content = "取消选择"; Control<Button>("PrimaryButton").Content = "使用此文件夹"; Text("FooterNote", "仅选择目录，不读取其中的文件内容。");
            history.Clear(); historyIndex = -1;
            Task locations = LoadLocations();
            await Navigate(Control<TextBox>("InstallDirectory").Text, true);
            await locations;
        }
        private async Task LoadLocations()
        {
            if (LoadLocationsAsync == null) return;
            try {
                IList<SetupLocation> values = await LoadLocationsAsync();
                if (!pickerOpen) return;
                StackPanel panel = Control<StackPanel>("Locations"); while (panel.Children.Count > 1) panel.Children.RemoveAt(1);
                foreach (SetupLocation value in values) {
                    SetupLocation location = value;
                    Button button = new Button { Content = location.Name, ToolTip = location.Path, HorizontalContentAlignment = HorizontalAlignment.Left, HorizontalAlignment = HorizontalAlignment.Stretch, Style = (Style)surface.FindResource("Quiet") };
                    button.Click += async delegate { await Navigate(location.Path, true); }; panel.Children.Add(button);
                }
            } catch (Exception error) { if (pickerOpen) Text("PickerError", "常用位置暂未全部读取。" + PublicMessage(error)); }
        }
        private async Task Navigate(string target, bool addHistory)
        {
            if (!pickerOpen || pickerBusy) return;
            if (ListDirectoriesAsync == null) { Text("PickerError", "文件夹浏览器尚未就绪，请返回重试。"); return; }
            int generation = ++directoryGeneration; PickerBusy(true); Text("PickerError", "");
            try {
                SetupDirectoryListing result = await ListDirectoriesAsync(target);
                if (!pickerOpen || generation != directoryGeneration) return;
                ApplyListing(result);
                if (addHistory && (historyIndex < 0 || !String.Equals(history[historyIndex], currentDirectory, StringComparison.OrdinalIgnoreCase))) { if (historyIndex + 1 < history.Count) history.RemoveRange(historyIndex + 1, history.Count - historyIndex - 1); history.Add(currentDirectory); historyIndex = history.Count - 1; }
                Control<Button>("BackButton").IsEnabled = historyIndex > 0;
            } catch (Exception error) { if (pickerOpen && generation == directoryGeneration) { Text("PickerError", PublicMessage(error)); Control<TextBox>("PickerPath").Text = currentDirectory; } }
            finally { if (generation == directoryGeneration) PickerBusy(false); }
        }
        private void ApplyListing(SetupDirectoryListing result)
        {
            if (result == null || String.IsNullOrEmpty(result.Path)) throw new InvalidOperationException("未取得文件夹列表，请重试。");
            currentDirectory = result.Path; parentDirectory = result.ParentPath;
            Control<TextBox>("PickerPath").Text = currentDirectory;
            Control<ListBox>("Directories").ItemsSource = result.Directories ?? new List<SetupDirectory>();
            Control<ListBox>("Directories").SelectedItem = null;
            directoryCount = result.Directories == null ? 0 : result.Directories.Count;
            Text("DirectoryCount", directoryCount + " 个子文件夹"); Visible("DirectoryEmpty", directoryCount == 0); UpdateBreadcrumbs(); UpdateTarget();
        }
        private void UpdateBreadcrumbs()
        {
            WrapPanel panel = Control<WrapPanel>("Breadcrumbs"); panel.Children.Clear();
            string root; try { root = Path.GetPathRoot(currentDirectory); } catch { return; }
            if (String.IsNullOrEmpty(root)) return;
            string value = root; AddCrumb(panel, root, root);
            foreach (string piece in currentDirectory.Substring(root.Length).Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries)) { value = Path.Combine(value, piece); AddCrumb(panel, piece, value); }
        }
        private void AddCrumb(WrapPanel panel, string title, string path)
        {
            if (panel.Children.Count > 0) panel.Children.Add(new TextBlock { Text = "›", Margin = new Thickness(0, 6, 0, 0), Foreground = Brushes.Gray });
            Button button = new Button { Content = title, ToolTip = path, MaxWidth = 155, Style = (Style)surface.FindResource("Quiet"), Padding = new Thickness(7, 3, 7, 3), MinHeight = 28 };
            button.Click += async delegate { await Navigate(path, true); }; panel.Children.Add(button);
        }
        private async Task GoBack()
        {
            if (pickerBusy || historyIndex < 1) return;
            int previous = historyIndex; historyIndex--;
            await Navigate(history[historyIndex], false);
            if (String.Equals(currentDirectory, history[previous], StringComparison.OrdinalIgnoreCase)) historyIndex = previous;
            Control<Button>("BackButton").IsEnabled = historyIndex > 0;
        }
        private async Task EnterSelected()
        {
            SetupDirectory value = Control<ListBox>("Directories").SelectedItem as SetupDirectory;
            if (value != null) await Navigate(value.Path, true);
        }
        private async Task CreateFolder()
        {
            if (pickerBusy || !pickerOpen || CreateFolderAsync == null) return;
            string name = Control<TextBox>("NewFolderName").Text;
            if (String.IsNullOrWhiteSpace(name)) { Text("PickerError", "请输入文件夹名称。"); return; }
            int generation = ++directoryGeneration; PickerBusy(true); Text("PickerError", "");
            try {
                SetupDirectoryListing result = await CreateFolderAsync(currentDirectory, name);
                if (!pickerOpen || generation != directoryGeneration) return;
                ApplyListing(result); Visible("NewFolderForm", false);
                if (historyIndex + 1 < history.Count) history.RemoveRange(historyIndex + 1, history.Count - historyIndex - 1);
                history.Add(currentDirectory); historyIndex = history.Count - 1;
            } catch (Exception error) { if (pickerOpen && generation == directoryGeneration) Text("PickerError", PublicMessage(error)); }
            finally { if (generation == directoryGeneration) { PickerBusy(false); Control<TextBox>("NewFolderName").Focus(); } }
        }
        private void PickerBusy(bool value)
        {
            pickerBusy = value;
            foreach (string name in new[] { "GoButton", "PickerPath", "NewFolderButton", "CreateFolderButton", "NewFolderName", "CancelNewFolderButton", "Directories" }) Control<Control>(name).IsEnabled = !value;
            Control<Button>("UpButton").IsEnabled = !value && !String.IsNullOrEmpty(parentDirectory); Control<Button>("BackButton").IsEnabled = !value && historyIndex > 0;
            Control<Button>("PrimaryButton").IsEnabled = !value && !String.IsNullOrEmpty(currentDirectory); Text("DirectoryCount", value ? "正在读取当前文件夹…" : directoryCount + " 个子文件夹");
        }
        private void UpdateTarget()
        {
            SetupDirectory selected = Control<ListBox>("Directories").SelectedItem as SetupDirectory;
            Text("PickerTarget", "将使用：" + (selected == null ? currentDirectory : selected.Path));
        }
        private void ClosePicker()
        {
            pickerOpen = false; directoryGeneration++; pickerBusy = false; Page("StartPage"); Visible("NewFolderForm", false);
            Control<Button>("PrimaryButton").Content = String.IsNullOrEmpty(options.InstalledVersion) ? "开始安装" : "开始更新"; Control<Button>("PrimaryButton").IsEnabled = true;
            Control<Button>("SecondaryButton").Content = "暂不安装"; Text("FooterNote", "本地安装 · 作品资料独立保存"); Control<Button>("ChangeDirectoryButton").Focus();
        }
        private static string PublicMessage(Exception error) { return error == null || String.IsNullOrWhiteSpace(error.Message) ? "未能完成操作，请检查位置或权限后重试。" : error.Message; }
        private void OnClosing(object sender, CancelEventArgs e) { if (!allowedClose && !completed) { e.Cancel = true; RequestClose(); } }
        private void RequestClose()
        {
            if (completed) { allowedClose = true; Close(); return; }
            if (pickerOpen) { ClosePicker(); return; }
            confirmBusy = busy; Visible("ConfirmOverlay", true);
            Text("ConfirmHeading", busy ? "当前操作正在进行" : failed ? "关闭维护窗口？" : options.Uninstall ? "暂不卸载？" : "暂不安装？");
            Text("ConfirmDetail", busy ? "为避免留下不完整的应用文件，请等待本次操作完成。你可以先最小化窗口，创作资料不会被删除。" : failed ? "本次操作尚未完成。已保留的创作资料不会删除，可以稍后重新运行维护程序重试。" : options.Uninstall ? "关闭后仍保留当前应用。" : "尚未开始文件操作。关闭窗口后可以稍后重新安装。" );
            Control<Button>("ConfirmCancel").Content = busy ? "继续等待" : failed ? "返回检查" : options.Uninstall ? "继续卸载" : "继续安装";
            Control<Button>("ConfirmAccept").Content = busy ? "最小化窗口" : "退出"; Control<Button>("ConfirmCancel").Focus();
        }
        private async void OnKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape) { e.Handled = true; if (Control<Border>("ConfirmOverlay").Visibility == Visibility.Visible) Visible("ConfirmOverlay", false); else if (pickerOpen && Control<Border>("NewFolderForm").Visibility == Visibility.Visible && !pickerBusy) Visible("NewFolderForm", false); else RequestClose(); return; }
            if (pickerOpen && !pickerBusy && (Keyboard.Modifiers & ModifierKeys.Control) != 0 && e.Key == Key.L) { e.Handled = true; Control<TextBox>("PickerPath").Focus(); Control<TextBox>("PickerPath").SelectAll(); }
            if (pickerOpen && !pickerBusy && (Keyboard.Modifiers & ModifierKeys.Alt) != 0 && e.Key == Key.Left) { e.Handled = true; await GoBack(); }
            if (pickerOpen && !pickerBusy && (Keyboard.Modifiers & ModifierKeys.Alt) != 0 && e.Key == Key.Up && !String.IsNullOrEmpty(parentDirectory)) { e.Handled = true; await Navigate(parentDirectory, true); }
        }
    }
}
