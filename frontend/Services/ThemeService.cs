using System.Collections;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using Fluxora.App.Models;
using Color = System.Windows.Media.Color;
using Colors = System.Windows.Media.Colors;
using WpfApplication = System.Windows.Application;
using WpfControl = System.Windows.Controls.Control;
using WpfPanel = System.Windows.Controls.Panel;
using WpfProgressBar = System.Windows.Controls.ProgressBar;

namespace Fluxora.App.Services;

public sealed class ThemeService : IAppService
{
    private static readonly TimeSpan TransitionDuration = TimeSpan.FromMilliseconds(260);
    private static readonly IEasingFunction TransitionEase = new CubicEase { EasingMode = EasingMode.EaseOut };
    private static readonly DependencyProperty ThemeReapplyHookedProperty = DependencyProperty.RegisterAttached(
        "ThemeReapplyHooked",
        typeof(bool),
        typeof(ThemeService),
        new PropertyMetadata(false));
    private static WeakReference<ThemeService>? currentService;
    private static bool themeEventHandlersRegistered;

    private readonly SettingsService settingsService;
    private AppTheme currentTheme = AppTheme.Dark;

    public ThemeService(SettingsService settingsService)
    {
        this.settingsService = settingsService;
    }

    public event EventHandler? ThemeChanged;

    public AppTheme CurrentTheme => currentTheme;

    public bool IsLightThemeEnabled => currentTheme == AppTheme.Light;

    public void ApplyCurrentThemeTo(DependencyObject root)
    {
        ArgumentNullException.ThrowIfNull(root);
        ThemePalette palette = ThemePalette.For(currentTheme);
        if (root is Window window)
        {
            ApplyToWindow(window, palette, animate: false);
            return;
        }

        ApplyVisualTree(root, palette, animate: false);
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        currentTheme = settingsService.Theme;
        currentService = new WeakReference<ThemeService>(this);
        RegisterThemeEventHandlers();
        ApplyTheme(currentTheme, animate: false);
        return Task.CompletedTask;
    }

    public async Task SetThemeAsync(AppTheme theme, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        bool changed = theme != currentTheme;
        currentTheme = theme;
        ApplyTheme(theme, animate: changed);
        await settingsService.SaveThemeAsync(theme, cancellationToken);

        if (changed)
        {
            ThemeChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    private void ApplyTheme(AppTheme theme, bool animate)
    {
        ThemePalette palette = ThemePalette.For(theme);
        ApplyResourceDictionary(WpfApplication.Current?.Resources, palette, animate);
        WindowChromeService.SetTheme(theme);

        if (WpfApplication.Current is null)
        {
            return;
        }

        foreach (Window window in WpfApplication.Current.Windows.OfType<Window>())
        {
            ApplyToWindow(window, palette, animate);
        }
    }

    private void ApplyToWindow(Window window, ThemePalette palette, bool animate)
    {
        ApplyResourceDictionary(window.Resources, palette, animate);
        ApplyVisualTree(window, palette, animate);
        WindowChromeService.ApplyTheme(window, currentTheme);
    }

    private static void RegisterThemeEventHandlers()
    {
        if (themeEventHandlersRegistered)
        {
            return;
        }

        EventManager.RegisterClassHandler(
            typeof(Window),
            FrameworkElement.LoadedEvent,
            new RoutedEventHandler(OnWindowLoaded));
        EventManager.RegisterClassHandler(
            typeof(FrameworkElement),
            FrameworkElement.LoadedEvent,
            new RoutedEventHandler(OnElementLoaded));
        EventManager.RegisterClassHandler(
            typeof(FrameworkElement),
            UIElement.MouseEnterEvent,
            new System.Windows.Input.MouseEventHandler(OnElementInteractionChanged),
            handledEventsToo: true);
        EventManager.RegisterClassHandler(
            typeof(FrameworkElement),
            UIElement.MouseLeaveEvent,
            new System.Windows.Input.MouseEventHandler(OnElementInteractionChanged),
            handledEventsToo: true);
        EventManager.RegisterClassHandler(
            typeof(FrameworkElement),
            UIElement.GotKeyboardFocusEvent,
            new KeyboardFocusChangedEventHandler(OnElementInteractionChanged),
            handledEventsToo: true);
        EventManager.RegisterClassHandler(
            typeof(FrameworkElement),
            UIElement.LostKeyboardFocusEvent,
            new KeyboardFocusChangedEventHandler(OnElementInteractionChanged),
            handledEventsToo: true);
        EventManager.RegisterClassHandler(
            typeof(ToggleButton),
            ToggleButton.CheckedEvent,
            new RoutedEventHandler(OnElementInteractionChanged),
            handledEventsToo: true);
        EventManager.RegisterClassHandler(
            typeof(ToggleButton),
            ToggleButton.UncheckedEvent,
            new RoutedEventHandler(OnElementInteractionChanged),
            handledEventsToo: true);
        EventManager.RegisterClassHandler(
            typeof(Selector),
            Selector.SelectionChangedEvent,
            new SelectionChangedEventHandler(OnSelectorSelectionChanged),
            handledEventsToo: true);
        themeEventHandlersRegistered = true;
    }

    private static void OnWindowLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is Window window &&
            currentService?.TryGetTarget(out ThemeService? service) == true)
        {
            service.ApplyToWindow(window, ThemePalette.For(service.currentTheme), animate: false);
        }
    }

    private static void OnElementLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is Window)
        {
            return;
        }

        ApplyThemeToElement(sender, animate: false);
    }

    private static void OnElementInteractionChanged(object sender, RoutedEventArgs e)
    {
        ApplyThemeToElement(sender, animate: false, defer: true);
    }

    private static void OnSelectorSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        ApplyThemeToElement(sender, animate: false, defer: true);
    }

    private static void OnElementDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        ApplyThemeToElement(sender, animate: false, defer: true);
    }

    private static void ApplyThemeToElement(object sender, bool animate, bool defer = false)
    {
        if (sender is not DependencyObject element ||
            currentService is null ||
            !currentService.TryGetTarget(out ThemeService? service))
        {
            return;
        }

        ThemePalette palette = ThemePalette.For(service.currentTheme);
        if (!defer)
        {
            ApplyVisualTree(element, palette, animate);
            return;
        }

        DispatcherObject? dispatcherObject = element as DispatcherObject;
        if (dispatcherObject?.Dispatcher is null)
        {
            ApplyVisualTree(element, palette, animate);
            return;
        }

        dispatcherObject.Dispatcher.BeginInvoke(
            () => ApplyVisualTree(element, palette, animate),
            System.Windows.Threading.DispatcherPriority.Render);
    }

    private static void ApplyVisualTree(DependencyObject root, ThemePalette palette, bool animate)
    {
        AttachThemeReapplyHandlers(root);
        ApplyElementResources(root, palette, animate);
        ApplyDirectBrushes(root, palette, animate);

        int childCount;
        try
        {
            childCount = VisualTreeHelper.GetChildrenCount(root);
        }
        catch (InvalidOperationException)
        {
            childCount = 0;
        }

        for (int index = 0; index < childCount; index++)
        {
            ApplyVisualTree(VisualTreeHelper.GetChild(root, index), palette, animate);
        }

        if (root is Popup { Child: { } popupChild })
        {
            ApplyVisualTree(popupChild, palette, animate);
        }
    }

    private static void AttachThemeReapplyHandlers(DependencyObject root)
    {
        if (root is not FrameworkElement frameworkElement ||
            root.GetValue(ThemeReapplyHookedProperty) is true ||
            root is not (DataGridRow or ListBoxItem))
        {
            return;
        }

        frameworkElement.DataContextChanged += OnElementDataContextChanged;
        root.SetValue(ThemeReapplyHookedProperty, true);
    }

    private static void ApplyElementResources(DependencyObject root, ThemePalette palette, bool animate)
    {
        if (root is FrameworkElement frameworkElement)
        {
            ApplyResourceDictionary(frameworkElement.Resources, palette, animate);
        }

        if (root is FrameworkContentElement frameworkContentElement)
        {
            ApplyResourceDictionary(frameworkContentElement.Resources, palette, animate);
        }
    }

    private static void ApplyResourceDictionary(ResourceDictionary? resources, ThemePalette palette, bool animate)
    {
        if (resources is null)
        {
            return;
        }

        foreach (DictionaryEntry entry in resources.Cast<DictionaryEntry>().ToArray())
        {
            if (entry.Key is not string key)
            {
                continue;
            }

            switch (entry.Value)
            {
                case SolidColorBrush brush
                    when palette.TryResolveResourceBrushRole(key, brush.Color, out string? role) &&
                         role is not null:
                    SetResourceBrushColor(resources, key, brush, palette.ColorForRole(role, brush.Color.A), animate);
                    break;
                case GradientBrush gradient:
                    ApplyResourceGradient(resources, key, gradient, palette, animate);
                    break;
            }
        }

        foreach (ResourceDictionary mergedDictionary in resources.MergedDictionaries)
        {
            ApplyResourceDictionary(mergedDictionary, palette, animate);
        }
    }

    private static void ApplyDirectBrushes(DependencyObject element, ThemePalette palette, bool animate)
    {
        switch (element)
        {
            case Window window:
                ApplyBrushProperty(window, Window.BackgroundProperty, palette, animate);
                break;
            case Border border:
                ApplyBrushProperty(border, Border.BackgroundProperty, palette, animate);
                ApplyBrushProperty(border, Border.BorderBrushProperty, palette, animate);
                break;
            case WpfPanel panel:
                ApplyBrushProperty(panel, WpfPanel.BackgroundProperty, palette, animate);
                break;
            case Shape shape:
                ApplyBrushProperty(shape, Shape.FillProperty, palette, animate);
                ApplyBrushProperty(shape, Shape.StrokeProperty, palette, animate);
                break;
        }

        if (element is WpfControl control)
        {
            ApplyBrushProperty(control, WpfControl.BackgroundProperty, palette, animate);
            ApplyBrushProperty(control, WpfControl.BorderBrushProperty, palette, animate);
            ApplyForegroundProperty(control, WpfControl.ForegroundProperty, palette, animate);
        }

        if (element is TextBlock textBlock)
        {
            ApplyForegroundProperty(textBlock, TextBlock.ForegroundProperty, palette, animate);
        }
    }

    private static void ApplyBrushProperty(
        DependencyObject owner,
        DependencyProperty property,
        ThemePalette palette,
        bool animate)
    {
        if (TryResolveProgressBrushRole(owner, property, out string? progressRole) &&
            owner.GetValue(property) is SolidColorBrush progressBrush)
        {
            SetBrushPropertyColor(owner, property, progressBrush, palette.ColorForRole(progressRole, progressBrush.Color.A), animate);
            return;
        }

        switch (owner.GetValue(property))
        {
            case SolidColorBrush brush
                when palette.TryResolveSurfaceRole(brush.Color, SurfaceHintFor(property), out string? role) &&
                     role is not null:
                SetBrushPropertyColor(owner, property, brush, palette.ColorForRole(role, brush.Color.A), animate);
                break;
            case GradientBrush gradient:
                ApplyGradientBrushProperty(owner, property, gradient, palette, animate);
                break;
        }
    }

    private static bool TryResolveProgressBrushRole(
        DependencyObject owner,
        DependencyProperty property,
        out string role)
    {
        if (owner is WpfProgressBar && property == WpfControl.BackgroundProperty)
        {
            role = "ProgressTrackBrush";
            return true;
        }

        if (owner is FrameworkElement { Name: "PART_Track" } &&
            HasAncestor<WpfProgressBar>(owner))
        {
            if (property == Border.BackgroundProperty)
            {
                role = "ProgressTrackBrush";
                return true;
            }

            if (property == Border.BorderBrushProperty)
            {
                role = "ProgressTrackBorderBrush";
                return true;
            }
        }

        if (owner is FrameworkElement { Name: "PulseLayer" } &&
            property == Border.BorderBrushProperty &&
            HasAncestor<WpfProgressBar>(owner))
        {
            role = "ProgressPulseBorderBrush";
            return true;
        }

        if (owner is Border &&
            property == Border.BorderBrushProperty &&
            HasAncestor<WpfProgressBar>(owner))
        {
            role = "ProgressTrackBorderBrush";
            return true;
        }

        role = string.Empty;
        return false;
    }

    private static bool HasAncestor<T>(DependencyObject owner)
        where T : DependencyObject
    {
        for (DependencyObject? current = GetParent(owner); current is not null; current = GetParent(current))
        {
            if (current is T)
            {
                return true;
            }
        }

        return false;
    }

    private static void ApplyForegroundProperty(
        DependencyObject owner,
        DependencyProperty property,
        ThemePalette palette,
        bool animate)
    {
        if (owner.GetValue(property) is not SolidColorBrush brush ||
            !palette.TryResolveForegroundRole(brush.Color, out string? role) ||
            role is null)
        {
            return;
        }

        string? backgroundRole = FindNearestBackgroundRole(owner, palette);
        if (palette.ShouldKeepLightForeground(backgroundRole))
        {
            return;
        }

        Color targetColor = palette.ColorForRole(role, brush.Color.A);
        SetBrushPropertyColor(owner, property, brush, targetColor, animate);
    }

    private static string? FindNearestBackgroundRole(DependencyObject owner, ThemePalette palette)
    {
        for (DependencyObject? current = owner; current is not null; current = GetParent(current))
        {
            SolidColorBrush? brush = current switch
            {
                Window window => window.Background as SolidColorBrush,
                Border border => border.Background as SolidColorBrush,
                WpfPanel panel => panel.Background as SolidColorBrush,
                WpfControl control => control.Background as SolidColorBrush,
                Shape shape => shape.Fill as SolidColorBrush,
                _ => null
            };

            if (brush is not null &&
                palette.TryResolveSurfaceRole(brush.Color, SurfaceHintForBackground(), out string? role))
            {
                return role;
            }
        }

        return null;
    }

    private static DependencyObject? GetParent(DependencyObject current)
    {
        try
        {
            DependencyObject? visualParent = VisualTreeHelper.GetParent(current);
            if (visualParent is not null)
            {
                return visualParent;
            }
        }
        catch (InvalidOperationException)
        {
        }

        return LogicalTreeHelper.GetParent(current);
    }

    private static void SetBrushColor(SolidColorBrush brush, Color targetColor, bool animate)
    {
        if (brush.IsFrozen || brush.Color == targetColor)
        {
            return;
        }

        if (!animate)
        {
            brush.BeginAnimation(SolidColorBrush.ColorProperty, null);
            brush.Color = targetColor;
            return;
        }

        ColorAnimation animation = new()
        {
            To = targetColor,
            Duration = TransitionDuration,
            EasingFunction = TransitionEase
        };
        animation.Completed += (_, _) =>
        {
            brush.BeginAnimation(SolidColorBrush.ColorProperty, null);
            if (!brush.IsFrozen)
            {
                brush.Color = targetColor;
            }
        };
        brush.BeginAnimation(SolidColorBrush.ColorProperty, animation, HandoffBehavior.SnapshotAndReplace);
    }

    private static void SetBrushPropertyColor(
        DependencyObject owner,
        DependencyProperty property,
        SolidColorBrush brush,
        Color targetColor,
        bool animate)
    {
        if (brush.Color == targetColor)
        {
            return;
        }

        if (brush.IsFrozen)
        {
            owner.SetCurrentValue(property, new SolidColorBrush(targetColor));
            return;
        }

        SetBrushColor(brush, targetColor, animate);
    }

    private static void SetResourceBrushColor(
        ResourceDictionary resources,
        string key,
        SolidColorBrush brush,
        Color targetColor,
        bool animate)
    {
        if (brush.Color == targetColor)
        {
            return;
        }

        if (brush.IsFrozen)
        {
            resources[key] = new SolidColorBrush(targetColor);
            return;
        }

        SetBrushColor(brush, targetColor, animate);
    }

    private static void ApplyResourceGradient(
        ResourceDictionary resources,
        string key,
        GradientBrush gradient,
        ThemePalette palette,
        bool animate)
    {
        IReadOnlyList<Color> targetColors = palette.ResolveGradientColors(key, gradient);
        if (targetColors.Count == 0)
        {
            return;
        }

        if (gradient.IsFrozen)
        {
            resources[key] = CloneGradientWithColors(gradient, targetColors);
            return;
        }

        ApplyGradientStopColors(gradient, targetColors, animate);
    }

    private static void ApplyGradientBrushProperty(
        DependencyObject owner,
        DependencyProperty property,
        GradientBrush gradient,
        ThemePalette palette,
        bool animate)
    {
        IReadOnlyList<Color> targetColors = palette.ResolveGradientColors(null, gradient);
        if (targetColors.Count == 0)
        {
            return;
        }

        if (gradient.IsFrozen)
        {
            owner.SetCurrentValue(property, CloneGradientWithColors(gradient, targetColors));
            return;
        }

        ApplyGradientStopColors(gradient, targetColors, animate);
    }

    private static GradientBrush CloneGradientWithColors(GradientBrush source, IReadOnlyList<Color> targetColors)
    {
        GradientBrush clone = source.CloneCurrentValue();
        int count = Math.Min(clone.GradientStops.Count, targetColors.Count);
        for (int index = 0; index < count; index++)
        {
            clone.GradientStops[index].Color = targetColors[index];
        }

        return clone;
    }

    private static void ApplyGradientStopColors(GradientBrush gradient, IReadOnlyList<Color> targetColors, bool animate)
    {
        int count = Math.Min(gradient.GradientStops.Count, targetColors.Count);
        for (int index = 0; index < count; index++)
        {
            SetGradientStopColor(gradient.GradientStops[index], targetColors[index], animate);
        }
    }

    private static void SetGradientStopColor(GradientStop stop, Color targetColor, bool animate)
    {
        if (stop.IsFrozen || stop.Color == targetColor)
        {
            return;
        }

        if (!animate)
        {
            stop.BeginAnimation(GradientStop.ColorProperty, null);
            stop.Color = targetColor;
            return;
        }

        ColorAnimation animation = new()
        {
            To = targetColor,
            Duration = TransitionDuration,
            EasingFunction = TransitionEase
        };
        animation.Completed += (_, _) =>
        {
            stop.BeginAnimation(GradientStop.ColorProperty, null);
            if (!stop.IsFrozen)
            {
                stop.Color = targetColor;
            }
        };
        stop.BeginAnimation(GradientStop.ColorProperty, animation, HandoffBehavior.SnapshotAndReplace);
    }

    private static SurfaceHint SurfaceHintFor(DependencyProperty property)
    {
        return property == Border.BorderBrushProperty ||
            property == WpfControl.BorderBrushProperty ||
            property == Shape.StrokeProperty
            ? SurfaceHint.Line
            : SurfaceHint.Surface;
    }

    private static SurfaceHint SurfaceHintForBackground()
    {
        return SurfaceHint.Surface;
    }

    private enum SurfaceHint
    {
        Surface,
        Line
    }

    private sealed class ThemePalette
    {
        private readonly Dictionary<Color, string> surfaceRoles;
        private readonly Dictionary<Color, string> foregroundRoles;
        private readonly bool isLight;

        private ThemePalette(
            IReadOnlyDictionary<string, Color> brushColors,
            IReadOnlyDictionary<string, Color[]> gradientColors,
            Dictionary<Color, string> surfaceRoles,
            Dictionary<Color, string> foregroundRoles,
            bool isLight)
        {
            BrushColors = brushColors;
            GradientColors = gradientColors;
            this.surfaceRoles = surfaceRoles;
            this.foregroundRoles = foregroundRoles;
            this.isLight = isLight;
        }

        public IReadOnlyDictionary<string, Color> BrushColors { get; }

        public IReadOnlyDictionary<string, Color[]> GradientColors { get; }

        public static ThemePalette For(AppTheme theme)
        {
            return theme == AppTheme.Light ? Light : Dark;
        }

        public bool TryResolveResourceBrushRole(string key, Color color, out string? role)
        {
            if (BrushColors.ContainsKey(key))
            {
                role = key;
                return true;
            }

            if (IsForegroundResourceKey(key))
            {
                return TryResolveForegroundRole(color, out role);
            }

            return TryResolveSurfaceRole(color, SurfaceHintForResourceKey(key), out role);
        }

        public bool TryResolveSurfaceRole(Color color, SurfaceHint hint, out string? role)
        {
            Color normalized = Normalize(color);
            if (surfaceRoles.TryGetValue(normalized, out role))
            {
                return true;
            }

            if (isLight && TryResolveLightSurfaceFallback(normalized, hint, out role))
            {
                return true;
            }

            role = null;
            return false;
        }

        public bool TryResolveForegroundRole(Color color, out string? role)
        {
            Color normalized = Normalize(color);
            if (foregroundRoles.TryGetValue(normalized, out role))
            {
                return true;
            }

            if (isLight && TryResolveLightForegroundFallback(normalized, out role))
            {
                return true;
            }

            role = null;
            return false;
        }

        public Color ColorForRole(string role, byte alpha)
        {
            Color color = BrushColors[role];
            color.A = alpha;
            return color;
        }

        public bool ShouldKeepLightForeground(string? backgroundRole)
        {
            if (backgroundRole is null)
            {
                return !isLight;
            }

            return backgroundRole is
                "AccentBrush" or
                "AccentHoverBrush" or
                "ErrorBrush" or
                "SuccessBrush" or
                "ConflictOverwritesBrush" or
                "ConflictOverwrittenBrush";
        }

        public IReadOnlyList<Color> ResolveGradientColors(string? key, GradientBrush gradient)
        {
            if (key is not null && GradientColors.TryGetValue(key, out Color[]? knownColors))
            {
                return PreserveGradientAlpha(knownColors, gradient);
            }

            Color[] colors = new Color[gradient.GradientStops.Count];
            for (int index = 0; index < gradient.GradientStops.Count; index++)
            {
                Color stopColor = gradient.GradientStops[index].Color;
                if (!TryResolveSurfaceRole(stopColor, SurfaceHint.Surface, out string? role) || role is null)
                {
                    return Array.Empty<Color>();
                }

                colors[index] = ColorForRole(role, stopColor.A);
            }

            return colors;
        }

        private static readonly ThemePalette Dark = CreateDark();
        private static readonly ThemePalette Light = CreateLight();

        private static ThemePalette CreateDark()
        {
            Dictionary<string, Color> colors = new(StringComparer.Ordinal)
            {
                ["TextBrush"] = Rgb(0xF4, 0xF8, 0xFF),
                ["TextSecondaryBrush"] = Rgb(0xC7, 0xD4, 0xE7),
                ["MutedTextBrush"] = Rgb(0x8B, 0x9A, 0xB0),
                ["SubtleTextBrush"] = Rgb(0x69, 0x7A, 0x91),
                ["AccentBrush"] = Rgb(0x4D, 0x8D, 0xF7),
                ["AccentHoverBrush"] = Rgb(0x6F, 0xA5, 0xFF),
                ["AccentSoftBrush"] = Rgb(0x09, 0x1C, 0x35),
                ["AccentLineBrush"] = Rgb(0x30, 0x5B, 0x94),
                ["NavSelectedBrush"] = Rgb(0x1B, 0x2F, 0x46),
                ["NavSelectedLineBrush"] = Rgb(0x5C, 0x8F, 0xE5),
                ["PanelBrush"] = Rgb(0x0A, 0x10, 0x18),
                ["PanelRaisedBrush"] = Rgb(0x0F, 0x17, 0x24),
                ["PanelSoftBrush"] = Rgb(0x05, 0x0A, 0x11),
                ["PanelHoverBrush"] = Rgb(0x14, 0x20, 0x33),
                ["LineBrush"] = Rgb(0x1B, 0x2B, 0x41),
                ["LineHoverBrush"] = Rgb(0x2F, 0x4E, 0x75),
                ["WarningBrush"] = Rgb(0xFB, 0xBF, 0x24),
                ["ErrorBrush"] = Rgb(0xFB, 0x71, 0x85),
                ["SuccessBrush"] = Rgb(0x7D, 0xD3, 0xFC),
                ["ConflictOverwritesBrush"] = Rgb(0x22, 0xC5, 0x5E),
                ["ConflictOverwrittenBrush"] = Rgb(0xEF, 0x44, 0x44),
                ["ConflictFullyOverwrittenBrush"] = Rgb(0x9C, 0xA3, 0xAF),
                ["WindowBackgroundBrush"] = Rgb(0x02, 0x05, 0x0A),
                ["ChromeBrush"] = Rgb(0x04, 0x08, 0x10),
                ["ChromeLineBrush"] = Rgb(0x10, 0x1A, 0x29),
                ["ChromeBrandBrush"] = Rgb(0xF4, 0xF8, 0xFF),
                ["IconTileBrush"] = Rgb(0x09, 0x1C, 0x35),
                ["IconTileBorderBrush"] = Rgb(0x30, 0x5B, 0x94),
                ["IconTileForegroundBrush"] = Rgb(0xF4, 0xF8, 0xFF),
                ["ProgressTrackBrush"] = Rgb(0x0D, 0x14, 0x20),
                ["ProgressTrackBorderBrush"] = Rgb(0x1E, 0x35, 0x55),
                ["ProgressPulseBorderBrush"] = Rgb(0x6F, 0xA5, 0xFF),
                ["ToggleOnBrush"] = Rgb(0x4D, 0x8D, 0xF7),
                ["ToggleOnHoverBrush"] = Rgb(0x6F, 0xA5, 0xFF),
                ["ToggleOnBorderBrush"] = Rgb(0x6F, 0xA5, 0xFF),
                ["ToggleThumbOnBrush"] = Rgb(0xF4, 0xF8, 0xFF),
                ["SplashTextBrush"] = Rgb(0xF4, 0xF8, 0xFF),
                ["SplashSecondaryTextBrush"] = Rgb(0xC7, 0xD4, 0xE7),
                ["SplashMutedTextBrush"] = Rgb(0x8C, 0x9C, 0xB3),
                ["ErrorSurfaceBrush"] = Rgb(0x2A, 0x12, 0x20),
                ["ErrorLineBrush"] = Rgb(0x7F, 0x1D, 0x3A),
                ["WarningSurfaceBrush"] = Rgb(0x24, 0x1A, 0x12),
                ["WarningLineBrush"] = Rgb(0x6D, 0x4D, 0x1F),
                ["SuccessSurfaceBrush"] = Rgb(0x16, 0x26, 0x22),
                ["SuccessLineBrush"] = Rgb(0x35, 0x6B, 0x68),
                ["PrimaryForegroundBrush"] = Rgb(0xF4, 0xF8, 0xFF)
            };

            Dictionary<string, Color[]> gradients = new(StringComparer.Ordinal)
            {
                ["AppBackgroundBrush"] =
                [
                    Rgb(0x02, 0x05, 0x0A),
                    Rgb(0x05, 0x0A, 0x11),
                    Rgb(0x08, 0x10, 0x1B)
                ],
                ["HeroBrush"] =
                [
                    Rgb(0x14, 0x2A, 0x4A),
                    Rgb(0x0E, 0x1A, 0x2B),
                    Rgb(0x0A, 0x10, 0x18)
                ],
                ["AccentGradientBrush"] =
                [
                    Rgb(0x6F, 0xA5, 0xFF),
                    Rgb(0x3F, 0x7E, 0xEA),
                    Rgb(0x1F, 0x5F, 0xCE)
                ],
                ["ProgressGradientBrush"] =
                [
                    Rgb(0x7D, 0xD3, 0xFC),
                    Rgb(0x6F, 0xA5, 0xFF),
                    Rgb(0x9E, 0xC5, 0xFF)
                ],
                ["SplashWindowBrush"] =
                [
                    Rgb(0x10, 0x21, 0x3D),
                    Rgb(0x04, 0x08, 0x10),
                    Rgb(0x10, 0x18, 0x27)
                ],
                ["SplashAccentBrush"] =
                [
                    Rgb(0xF4, 0xF8, 0xFF),
                    Rgb(0xC9, 0xDF, 0xFF),
                    Rgb(0x4D, 0x8D, 0xF7)
                ],
                ["SplashCoreBrush"] =
                [
                    Rgb(0xF4, 0xF8, 0xFF),
                    Rgb(0xC9, 0xDF, 0xFF),
                    Rgb(0x6F, 0xA5, 0xFF)
                ],
                ["SplashProgressBrush"] =
                [
                    Rgb(0x34, 0xD3, 0x99),
                    Rgb(0x4D, 0x8D, 0xF7),
                    Rgb(0x6F, 0xA5, 0xFF)
                ],
                ["CreationProgressBrush"] =
                [
                    Rgb(0x7D, 0xD3, 0xFC),
                    Rgb(0xA8, 0xCA, 0xFF),
                    Rgb(0x6F, 0xA5, 0xFF)
                ],
                ["DeletionProgressBrush"] =
                [
                    Rgb(0xFB, 0x71, 0x85),
                    Rgb(0xF6, 0xC8, 0xD1),
                    Rgb(0xA8, 0xCA, 0xFF)
                ],
                ["OperationProgressBrush"] =
                [
                    Rgb(0x7D, 0xD3, 0xFC),
                    Rgb(0x6F, 0xA5, 0xFF),
                    Rgb(0x9E, 0xC5, 0xFF)
                ],
                ["LaunchProgressBrush"] =
                [
                    Rgb(0x5E, 0xEA, 0xD4),
                    Rgb(0x7D, 0xD3, 0xFC),
                    Rgb(0xA8, 0xCA, 0xFF)
                ],
                ["InstallProgressBrush"] =
                [
                    Rgb(0x5E, 0xEA, 0xD4),
                    Rgb(0x38, 0xBD, 0xF8),
                    Rgb(0xA8, 0xCA, 0xFF)
                ],
                ["PackageProgressBrush"] =
                [
                    Rgb(0x5E, 0xEA, 0xD4),
                    Rgb(0x7D, 0xD3, 0xFC),
                    Rgb(0xA8, 0xCA, 0xFF)
                ]
            };

            return CreatePalette(colors, gradients, isLight: false);
        }

        private static ThemePalette CreateLight()
        {
            Dictionary<string, Color> colors = new(StringComparer.Ordinal)
            {
                ["TextBrush"] = Rgb(0x11, 0x11, 0x11),
                ["TextSecondaryBrush"] = Rgb(0x33, 0x33, 0x33),
                ["MutedTextBrush"] = Rgb(0x66, 0x66, 0x66),
                ["SubtleTextBrush"] = Rgb(0x80, 0x80, 0x80),
                ["AccentBrush"] = Rgb(0x11, 0x11, 0x11),
                ["AccentHoverBrush"] = Rgb(0x00, 0x00, 0x00),
                ["AccentSoftBrush"] = Rgb(0xF2, 0xF2, 0xF2),
                ["AccentLineBrush"] = Rgb(0xB8, 0xB8, 0xB8),
                ["NavSelectedBrush"] = Rgb(0xF2, 0xF2, 0xF2),
                ["NavSelectedLineBrush"] = Rgb(0x11, 0x11, 0x11),
                ["PanelBrush"] = Rgb(0xFF, 0xFF, 0xFF),
                ["PanelRaisedBrush"] = Rgb(0xF7, 0xF7, 0xF7),
                ["PanelSoftBrush"] = Rgb(0xF2, 0xF2, 0xF2),
                ["PanelHoverBrush"] = Rgb(0xE8, 0xE8, 0xE8),
                ["LineBrush"] = Rgb(0xD0, 0xD0, 0xD0),
                ["LineHoverBrush"] = Rgb(0x9E, 0x9E, 0x9E),
                ["WarningBrush"] = Rgb(0x4A, 0x4A, 0x4A),
                ["ErrorBrush"] = Rgb(0x11, 0x11, 0x11),
                ["SuccessBrush"] = Rgb(0x33, 0x33, 0x33),
                ["ConflictOverwritesBrush"] = Rgb(0x22, 0x22, 0x22),
                ["ConflictOverwrittenBrush"] = Rgb(0x44, 0x44, 0x44),
                ["ConflictFullyOverwrittenBrush"] = Rgb(0x77, 0x77, 0x77),
                ["WindowBackgroundBrush"] = Rgb(0xF5, 0xF5, 0xF5),
                ["ChromeBrush"] = Rgb(0xFF, 0xFF, 0xFF),
                ["ChromeLineBrush"] = Rgb(0xD0, 0xD0, 0xD0),
                ["ChromeBrandBrush"] = Rgb(0x11, 0x11, 0x11),
                ["IconTileBrush"] = Rgb(0xE8, 0xE8, 0xE8),
                ["IconTileBorderBrush"] = Rgb(0xD0, 0xD0, 0xD0),
                ["IconTileForegroundBrush"] = Rgb(0x11, 0x11, 0x11),
                ["ProgressTrackBrush"] = Rgb(0x2A, 0x2A, 0x2A),
                ["ProgressTrackBorderBrush"] = Rgb(0x10, 0x10, 0x10),
                ["ProgressPulseBorderBrush"] = Rgb(0x4A, 0x4A, 0x4A),
                ["ToggleOnBrush"] = Rgb(0x16, 0xA3, 0x4A),
                ["ToggleOnHoverBrush"] = Rgb(0x15, 0x80, 0x3D),
                ["ToggleOnBorderBrush"] = Rgb(0x15, 0x80, 0x3D),
                ["ToggleThumbOnBrush"] = Rgb(0xFF, 0xFF, 0xFF),
                ["SplashTextBrush"] = Rgb(0xF4, 0xF8, 0xFF),
                ["SplashSecondaryTextBrush"] = Rgb(0xD1, 0xD5, 0xDB),
                ["SplashMutedTextBrush"] = Rgb(0x9C, 0xA3, 0xAF),
                ["ErrorSurfaceBrush"] = Rgb(0xF0, 0xF0, 0xF0),
                ["ErrorLineBrush"] = Rgb(0xB0, 0xB0, 0xB0),
                ["WarningSurfaceBrush"] = Rgb(0xF4, 0xF4, 0xF4),
                ["WarningLineBrush"] = Rgb(0xB8, 0xB8, 0xB8),
                ["SuccessSurfaceBrush"] = Rgb(0xEF, 0xEF, 0xEF),
                ["SuccessLineBrush"] = Rgb(0xAF, 0xAF, 0xAF),
                ["PrimaryForegroundBrush"] = Rgb(0xFF, 0xFF, 0xFF)
            };

            Dictionary<string, Color[]> gradients = new(StringComparer.Ordinal)
            {
                ["AppBackgroundBrush"] =
                [
                    Rgb(0xFF, 0xFF, 0xFF),
                    Rgb(0xF7, 0xF7, 0xF7),
                    Rgb(0xEF, 0xEF, 0xEF)
                ],
                ["HeroBrush"] =
                [
                    Rgb(0xF4, 0xF4, 0xF4),
                    Rgb(0xFF, 0xFF, 0xFF),
                    Rgb(0xFA, 0xFA, 0xFA)
                ],
                ["AccentGradientBrush"] =
                [
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x00, 0x00, 0x00)
                ],
                ["ProgressGradientBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["SplashWindowBrush"] =
                [
                    Rgb(0x16, 0x16, 0x16),
                    Rgb(0x26, 0x26, 0x26),
                    Rgb(0x34, 0x34, 0x34)
                ],
                ["SplashAccentBrush"] =
                [
                    Rgb(0x70, 0x70, 0x70),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x3A, 0x3A, 0x3A)
                ],
                ["SplashCoreBrush"] =
                [
                    Rgb(0x82, 0x82, 0x82),
                    Rgb(0x18, 0x18, 0x18),
                    Rgb(0x3A, 0x3A, 0x3A)
                ],
                ["SplashProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["CreationProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["DeletionProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["OperationProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["LaunchProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["InstallProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ],
                ["PackageProgressBrush"] =
                [
                    Rgb(0x33, 0x33, 0x33),
                    Rgb(0x11, 0x11, 0x11),
                    Rgb(0x55, 0x55, 0x55)
                ]
            };

            return CreatePalette(colors, gradients, isLight: true);
        }

        private static ThemePalette CreatePalette(
            IReadOnlyDictionary<string, Color> colors,
            IReadOnlyDictionary<string, Color[]> gradients,
            bool isLight)
        {
            Dictionary<Color, string> surfaceRoles = new();
            AddSurfaceRoles(surfaceRoles, colors);
            AddSurfaceAliases(surfaceRoles);

            Dictionary<Color, string> foregroundRoles = new();
            AddForegroundRoles(foregroundRoles, colors);
            AddForegroundAliases(foregroundRoles);

            return new ThemePalette(colors, gradients, surfaceRoles, foregroundRoles, isLight);
        }

        private static void AddSurfaceRoles(Dictionary<Color, string> roles, IReadOnlyDictionary<string, Color> colors)
        {
            foreach ((string key, Color color) in colors)
            {
                if (IsForegroundRole(key))
                {
                    continue;
                }

                roles[Normalize(color)] = key;
            }
        }

        private static void AddForegroundRoles(Dictionary<Color, string> roles, IReadOnlyDictionary<string, Color> colors)
        {
            foreach (string key in new[]
            {
                "TextBrush",
                "TextSecondaryBrush",
                "MutedTextBrush",
                "SubtleTextBrush",
                "AccentBrush",
                "AccentHoverBrush",
                "AccentLineBrush",
                "WarningBrush",
                "ErrorBrush",
                "SuccessBrush",
                "PrimaryForegroundBrush",
                "ChromeBrandBrush",
                "IconTileForegroundBrush",
                "ToggleThumbOnBrush",
                "SplashTextBrush",
                "SplashSecondaryTextBrush",
                "SplashMutedTextBrush"
            })
            {
                roles[Normalize(colors[key])] = key;
            }
        }

        private static bool IsForegroundRole(string key)
        {
            return key is
                "TextBrush" or
                "TextSecondaryBrush" or
                "MutedTextBrush" or
                "SubtleTextBrush" or
                "PrimaryForegroundBrush" or
                "ChromeBrandBrush" or
                "IconTileForegroundBrush" or
                "ToggleThumbOnBrush" or
                "SplashTextBrush" or
                "SplashSecondaryTextBrush" or
                "SplashMutedTextBrush";
        }

        private static void AddSurfaceAliases(Dictionary<Color, string> roles)
        {
            AddAlias(roles, "#02050A", "WindowBackgroundBrush");
            AddAlias(roles, "#040810", "ChromeBrush");
            AddAlias(roles, "#101A29", "ChromeLineBrush");
            AddAlias(roles, "#050A11", "PanelSoftBrush");
            AddAlias(roles, "#08101B", "PanelSoftBrush");
            AddAlias(roles, "#0A1018", "PanelBrush");
            AddAlias(roles, "#111925", "PanelBrush");
            AddAlias(roles, "#0D1420", "PanelRaisedBrush");
            AddAlias(roles, "#0E1A2B", "PanelRaisedBrush");
            AddAlias(roles, "#0F1724", "PanelRaisedBrush");
            AddAlias(roles, "#0F1928", "PanelRaisedBrush");
            AddAlias(roles, "#132238", "PanelHoverBrush");
            AddAlias(roles, "#142033", "PanelHoverBrush");
            AddAlias(roles, "#18355A", "AccentSoftBrush");
            AddAlias(roles, "#1B2B41", "LineBrush");
            AddAlias(roles, "#263846", "LineBrush");
            AddAlias(roles, "#293C4B", "LineBrush");
            AddAlias(roles, "#294775", "LineHoverBrush");
            AddAlias(roles, "#2F4E75", "LineHoverBrush");
            AddAlias(roles, "#2A1220", "ErrorSurfaceBrush");
            AddAlias(roles, "#7F1D3A", "ErrorLineBrush");
            AddAlias(roles, "#241A12", "WarningSurfaceBrush");
            AddAlias(roles, "#6D4D1F", "WarningLineBrush");
            AddAlias(roles, "#162622", "SuccessSurfaceBrush");
            AddAlias(roles, "#1D2A35", "SuccessSurfaceBrush");
            AddAlias(roles, "#356B68", "SuccessLineBrush");
            AddAlias(roles, "#F3F7FC", "WindowBackgroundBrush");
            AddAlias(roles, "#F5F5F5", "WindowBackgroundBrush");
            AddAlias(roles, "#FFFFFF", "PanelBrush");
            AddAlias(roles, "#D8E1EC", "ChromeLineBrush");
            AddAlias(roles, "#D0D0D0", "LineBrush");
            AddAlias(roles, "#F8FAFC", "PanelRaisedBrush");
            AddAlias(roles, "#F7F7F7", "PanelRaisedBrush");
            AddAlias(roles, "#F1F5F9", "PanelSoftBrush");
            AddAlias(roles, "#F2F2F2", "PanelSoftBrush");
            AddAlias(roles, "#E8EEF7", "PanelHoverBrush");
            AddAlias(roles, "#E8E8E8", "PanelHoverBrush");
            AddAlias(roles, "#CBD5E1", "LineBrush");
            AddAlias(roles, "#94A3B8", "LineHoverBrush");
            AddAlias(roles, "#9E9E9E", "LineHoverBrush");
            AddAlias(roles, "#FEE2E2", "ErrorSurfaceBrush");
            AddAlias(roles, "#F0F0F0", "ErrorSurfaceBrush");
            AddAlias(roles, "#FCA5A5", "ErrorLineBrush");
            AddAlias(roles, "#B0B0B0", "ErrorLineBrush");
            AddAlias(roles, "#FEF3C7", "WarningSurfaceBrush");
            AddAlias(roles, "#F4F4F4", "WarningSurfaceBrush");
            AddAlias(roles, "#FCD34D", "WarningLineBrush");
            AddAlias(roles, "#B8B8B8", "WarningLineBrush");
            AddAlias(roles, "#ECFDF5", "SuccessSurfaceBrush");
            AddAlias(roles, "#EFEFEF", "SuccessSurfaceBrush");
            AddAlias(roles, "#6EE7B7", "SuccessLineBrush");
            AddAlias(roles, "#AFAFAF", "SuccessLineBrush");
        }

        private static void AddForegroundAliases(Dictionary<Color, string> roles)
        {
            AddAlias(roles, "#FFFFFF", "TextBrush");
            AddAlias(roles, "#FFF1F4", "TextBrush");
            AddAlias(roles, "#F4F8FF", "TextBrush");
            AddAlias(roles, "#C9DFFF", "TextSecondaryBrush");
            AddAlias(roles, "#D8E8FF", "TextSecondaryBrush");
            AddAlias(roles, "#A8CAFF", "TextSecondaryBrush");
            AddAlias(roles, "#C7D4E7", "TextSecondaryBrush");
            AddAlias(roles, "#8B9AB0", "MutedTextBrush");
            AddAlias(roles, "#697A91", "SubtleTextBrush");
            AddAlias(roles, "#FDE68A", "WarningBrush");
            AddAlias(roles, "#FB7185", "ErrorBrush");
            AddAlias(roles, "#68E1D1", "SuccessBrush");
            AddAlias(roles, "#5EEAD4", "SuccessBrush");
            AddAlias(roles, "#4D8DF7", "AccentBrush");
            AddAlias(roles, "#3F7EEA", "AccentBrush");
            AddAlias(roles, "#1F5FCE", "AccentBrush");
            AddAlias(roles, "#6FA5FF", "AccentHoverBrush");
            AddAlias(roles, "#305B94", "AccentLineBrush");
            AddAlias(roles, "#5C8FE5", "AccentHoverBrush");
            AddAlias(roles, "#102033", "TextBrush");
            AddAlias(roles, "#111111", "TextBrush");
            AddAlias(roles, "#334155", "TextSecondaryBrush");
            AddAlias(roles, "#333333", "TextSecondaryBrush");
            AddAlias(roles, "#64748B", "MutedTextBrush");
            AddAlias(roles, "#666666", "MutedTextBrush");
            AddAlias(roles, "#7C8797", "SubtleTextBrush");
            AddAlias(roles, "#808080", "SubtleTextBrush");
            AddAlias(roles, "#B45309", "WarningBrush");
            AddAlias(roles, "#4A4A4A", "WarningBrush");
            AddAlias(roles, "#DC2626", "ErrorBrush");
            AddAlias(roles, "#000000", "TextBrush");
            AddAlias(roles, "#0284C7", "SuccessBrush");
        }

        private static bool IsForegroundResourceKey(string key)
        {
            return key.Contains("Text", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Foreground", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Caret", StringComparison.OrdinalIgnoreCase);
        }

        private static SurfaceHint SurfaceHintForResourceKey(string key)
        {
            return key.Contains("Line", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Border", StringComparison.OrdinalIgnoreCase) ||
                key.Contains("Stroke", StringComparison.OrdinalIgnoreCase)
                ? SurfaceHint.Line
                : SurfaceHint.Surface;
        }

        private static bool TryResolveLightSurfaceFallback(Color color, SurfaceHint hint, out string? role)
        {
            if (color.A == 0)
            {
                role = null;
                return false;
            }

            double luminance = Luminance(color);
            double saturation = Saturation(color);
            if (luminance >= 185 && saturation < 0.08)
            {
                role = null;
                return false;
            }

            if (hint == SurfaceHint.Line)
            {
                role = luminance < 55 || saturation > 0.12 ? "LineBrush" : "LineHoverBrush";
                return true;
            }

            role = luminance < 16
                ? "PanelSoftBrush"
                : luminance < 42
                    ? "PanelBrush"
                    : luminance < 80
                        ? "PanelRaisedBrush"
                        : "PanelHoverBrush";
            return luminance < 155 || saturation > 0.12;
        }

        private static bool TryResolveLightForegroundFallback(Color color, out string? role)
        {
            if (color.A == 0)
            {
                role = null;
                return false;
            }

            double luminance = Luminance(color);
            double saturation = Saturation(color);
            if (luminance < 78 && saturation < 0.1)
            {
                role = null;
                return false;
            }

            role = luminance > 220
                ? "TextBrush"
                : luminance > 150
                    ? "TextSecondaryBrush"
                    : "MutedTextBrush";
            return luminance > 96 || saturation > 0.18;
        }

        private static IReadOnlyList<Color> PreserveGradientAlpha(IReadOnlyList<Color> targetColors, GradientBrush source)
        {
            Color[] colors = new Color[Math.Min(source.GradientStops.Count, targetColors.Count)];
            for (int index = 0; index < colors.Length; index++)
            {
                colors[index] = targetColors[index];
                colors[index].A = source.GradientStops[index].Color.A;
            }

            return colors;
        }

        private static double Luminance(Color color)
        {
            return (0.2126 * color.R) + (0.7152 * color.G) + (0.0722 * color.B);
        }

        private static double Saturation(Color color)
        {
            double max = Math.Max(color.R, Math.Max(color.G, color.B)) / 255.0;
            double min = Math.Min(color.R, Math.Min(color.G, color.B)) / 255.0;
            return max <= 0 ? 0 : (max - min) / max;
        }

        private static void AddAlias(Dictionary<Color, string> roles, string hex, string role)
        {
            roles[ParseHex(hex)] = role;
        }

        private static Color Normalize(Color color)
        {
            color.A = 0xFF;
            return color;
        }

        private static Color Rgb(byte red, byte green, byte blue)
        {
            return Color.FromRgb(red, green, blue);
        }

        private static Color ParseHex(string hex)
        {
            string value = hex.TrimStart('#');
            if (value.Length == 8)
            {
                return Color.FromArgb(
                    Convert.ToByte(value[..2], 16),
                    Convert.ToByte(value[2..4], 16),
                    Convert.ToByte(value[4..6], 16),
                    Convert.ToByte(value[6..8], 16));
            }

            if (value.Length != 6)
            {
                return Colors.Transparent;
            }

            return Color.FromRgb(
                Convert.ToByte(value[..2], 16),
                Convert.ToByte(value[2..4], 16),
                Convert.ToByte(value[4..6], 16));
        }
    }
}
