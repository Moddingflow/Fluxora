using System.ComponentModel;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Fluxora.App.Models;
using Fluxora.App.Services;
using Fluxora.App.ViewModels;

namespace Fluxora.App;

public partial class FomodInstallerWindow : Window
{
    private const int PreviewDecodePixelWidth = 720;
    private const int DefaultLightboxDecodePixelWidth = 1200;
    private const int MinLightboxDecodePixelWidth = 720;
    private const int MaxLightboxDecodePixelWidth = 1800;
    private const double LightboxHorizontalMargin = 84;

    public static readonly DependencyProperty LightboxDecodePixelWidthProperty = DependencyProperty.Register(
        nameof(LightboxDecodePixelWidth),
        typeof(int),
        typeof(FomodInstallerWindow),
        new PropertyMetadata(DefaultLightboxDecodePixelWidth));

    private readonly WindowChromeService windowChromeService;
    private readonly FomodInstallerViewModel viewModel;

    public FomodInstallerWindow(FomodInstallerInfo installer)
    {
        InitializeComponent();
        viewModel = new FomodInstallerViewModel(installer);
        DataContext = viewModel;
        viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        SizeChanged += OnWindowSizeChanged;
        windowChromeService = new WindowChromeService(this);
        windowChromeService.Attach();
        Title = viewModel.ModuleTitle;
    }

    public IReadOnlyList<string> SelectedOptionIds => viewModel.SelectedOptionIds;

    public int LightboxDecodePixelWidth
    {
        get => (int)GetValue(LightboxDecodePixelWidthProperty);
        set => SetValue(LightboxDecodePixelWidthProperty, value);
    }

    private void OnPrimaryClick(object sender, RoutedEventArgs e)
    {
        if (!viewModel.IsLastStep)
        {
            if (!viewModel.MoveNext())
            {
                ScrollValidationTargetIntoView();
            }
            return;
        }

        if (!viewModel.TryFinish())
        {
            ScrollValidationTargetIntoView();
            return;
        }

        DialogResult = true;
        Close();
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        UpdateLightboxDecodePixelWidth();
        PrewarmPreviewImages();
        ScrollValidationTargetIntoView();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(FomodInstallerViewModel.ValidationTargetGroup) or nameof(FomodInstallerViewModel.CurrentStep))
        {
            Dispatcher.BeginInvoke(ScrollValidationTargetIntoView, DispatcherPriority.Loaded);
        }

        if (e.PropertyName is nameof(FomodInstallerViewModel.DetailsOption) or nameof(FomodInstallerViewModel.CurrentStep))
        {
            Dispatcher.BeginInvoke(PrewarmPreviewImages, DispatcherPriority.Background);
        }
    }

    private void OnOptionPreview(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: FomodOptionViewModel option })
        {
            viewModel.ShowOptionDetails(option);
        }
    }

    private void OnPreviewImageClick(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: FomodOptionViewModel { HasPreviewImage: true } option })
        {
            return;
        }

        UpdateLightboxDecodePixelWidth();
        LightboxImage.DataContext = option;
        DialogSurface.Effect = new BlurEffect { Radius = 8 };
        ImageLightboxOverlay.Visibility = Visibility.Visible;
        LightboxCloseButton.Focus();
    }

    private void OnWindowSizeChanged(object sender, SizeChangedEventArgs e)
    {
        UpdateLightboxDecodePixelWidth();
    }

    private void OnLightboxCloseClick(object sender, RoutedEventArgs e)
    {
        CloseImageLightbox();
    }

    private void OnLightboxBackgroundMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (ReferenceEquals(e.OriginalSource, ImageLightboxOverlay))
        {
            CloseImageLightbox();
        }
    }

    private void OnWindowDragMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left)
        {
            return;
        }

        try
        {
            DragMove();
        }
        catch (InvalidOperationException)
        {
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        Loaded -= OnLoaded;
        SizeChanged -= OnWindowSizeChanged;
        viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        base.OnClosed(e);
    }

    private void PrewarmPreviewImages()
    {
        FomodOptionViewModel? currentOption = viewModel.DetailsOption;
        PrewarmPreviewImage(currentOption, PreviewDecodePixelWidth);

        FomodOptionViewModel? nextOption = FindNextPreviewOption(currentOption);
        if (!ReferenceEquals(currentOption, nextOption))
        {
            PrewarmPreviewImage(nextOption, PreviewDecodePixelWidth);
        }
    }

    private static void PrewarmPreviewImage(FomodOptionViewModel? option, int decodePixelWidth)
    {
        if (option?.HasPreviewImage != true)
        {
            return;
        }

        _ = FomodImageSourceConverter.PrewarmImageAsync(option.PreviewImagePath, decodePixelWidth);
    }

    private FomodOptionViewModel? FindNextPreviewOption(FomodOptionViewModel? currentOption)
    {
        FomodStepViewModel? currentStep = viewModel.CurrentStep;
        if (currentStep is null)
        {
            return null;
        }

        bool returnNextPreview = currentOption is null;
        foreach (FomodGroupViewModel group in currentStep.Groups)
        {
            foreach (FomodOptionViewModel option in group.Options)
            {
                if (!option.HasPreviewImage)
                {
                    continue;
                }

                if (returnNextPreview)
                {
                    return option;
                }

                if (ReferenceEquals(option, currentOption))
                {
                    returnNextPreview = true;
                }
            }
        }

        return null;
    }

    private void UpdateLightboxDecodePixelWidth()
    {
        double availableWidth = ActualWidth - LightboxHorizontalMargin;
        if (double.IsNaN(availableWidth) || availableWidth <= 0)
        {
            availableWidth = DefaultLightboxDecodePixelWidth;
        }

        double dpiScale = VisualTreeHelper.GetDpi(this).DpiScaleX;
        int decodePixelWidth = (int)Math.Ceiling(availableWidth * dpiScale);
        LightboxDecodePixelWidth = Math.Clamp(
            decodePixelWidth,
            MinLightboxDecodePixelWidth,
            MaxLightboxDecodePixelWidth);
    }

    private void ScrollValidationTargetIntoView()
    {
        FomodGroupViewModel? targetGroup = viewModel.ValidationTargetGroup;
        FomodStepRowViewModel? targetRow = viewModel.ValidationTargetRow;
        if (targetGroup is null || targetRow is null)
        {
            return;
        }

        GroupItemsControl.ScrollIntoView(targetRow);
        GroupItemsControl.UpdateLayout();
        FrameworkElement? targetElement = FindElementForDataContext(GroupItemsControl, targetGroup);
        if (targetElement is null)
        {
            return;
        }

        targetElement.BringIntoView(new Rect(0, 0, targetElement.ActualWidth, targetElement.ActualHeight));
    }

    private void CloseImageLightbox()
    {
        ImageLightboxOverlay.Visibility = Visibility.Collapsed;
        LightboxImage.DataContext = null;
        DialogSurface.Effect = null;
    }

    private static FrameworkElement? FindElementForDataContext(DependencyObject root, object dataContext)
    {
        int childCount = VisualTreeHelper.GetChildrenCount(root);
        for (int index = 0; index < childCount; index++)
        {
            DependencyObject child = VisualTreeHelper.GetChild(root, index);
            if (child is FrameworkElement element && ReferenceEquals(element.DataContext, dataContext))
            {
                return element;
            }

            FrameworkElement? descendant = FindElementForDataContext(child, dataContext);
            if (descendant is not null)
            {
                return descendant;
            }
        }

        return null;
    }
}
