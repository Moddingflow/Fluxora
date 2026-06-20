using System.Windows;
using System.Windows.Media.Animation;

namespace Fluxora.App.Services;

public static class VisibleStoryboardService
{
    public static readonly DependencyProperty StoryboardProperty =
        DependencyProperty.RegisterAttached(
            "Storyboard",
            typeof(Storyboard),
            typeof(VisibleStoryboardService),
            new PropertyMetadata(null, OnStoryboardChanged));

    private static readonly DependencyProperty IsRunningProperty =
        DependencyProperty.RegisterAttached(
            "IsRunning",
            typeof(bool),
            typeof(VisibleStoryboardService),
            new PropertyMetadata(false));

    public static void SetStoryboard(DependencyObject element, Storyboard? value)
    {
        element.SetValue(StoryboardProperty, value);
    }

    public static Storyboard? GetStoryboard(DependencyObject element)
    {
        return (Storyboard?)element.GetValue(StoryboardProperty);
    }

    private static void OnStoryboardChanged(DependencyObject dependencyObject, DependencyPropertyChangedEventArgs e)
    {
        if (dependencyObject is not FrameworkElement element)
        {
            return;
        }

        Stop(element, e.OldValue as Storyboard);
        element.Loaded -= OnElementLoaded;
        element.Unloaded -= OnElementUnloaded;
        element.IsVisibleChanged -= OnElementIsVisibleChanged;

        if (e.NewValue is not Storyboard)
        {
            return;
        }

        element.Loaded += OnElementLoaded;
        element.Unloaded += OnElementUnloaded;
        element.IsVisibleChanged += OnElementIsVisibleChanged;
        Update(element);
    }

    private static void OnElementLoaded(object sender, RoutedEventArgs e)
    {
        Update((FrameworkElement)sender);
    }

    private static void OnElementUnloaded(object sender, RoutedEventArgs e)
    {
        Stop((FrameworkElement)sender, GetStoryboard((FrameworkElement)sender));
    }

    private static void OnElementIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        Update((FrameworkElement)sender);
    }

    private static void Update(FrameworkElement element)
    {
        Storyboard? storyboard = GetStoryboard(element);
        if (storyboard is null)
        {
            return;
        }

        if (element.IsLoaded && element.IsVisible)
        {
            Start(element, storyboard);
            return;
        }

        Stop(element, storyboard);
    }

    private static void Start(FrameworkElement element, Storyboard storyboard)
    {
        if (GetIsRunning(element))
        {
            return;
        }

        storyboard.Begin(element, isControllable: true);
        SetIsRunning(element, true);
    }

    private static void Stop(FrameworkElement element, Storyboard? storyboard)
    {
        if (storyboard is null || !GetIsRunning(element))
        {
            return;
        }

        storyboard.Remove(element);
        SetIsRunning(element, false);
    }

    private static bool GetIsRunning(DependencyObject element)
    {
        return (bool)element.GetValue(IsRunningProperty);
    }

    private static void SetIsRunning(DependencyObject element, bool value)
    {
        element.SetValue(IsRunningProperty, value);
    }
}
