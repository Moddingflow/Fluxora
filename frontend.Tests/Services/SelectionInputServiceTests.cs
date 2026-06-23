using System.Windows.Input;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class SelectionInputServiceTests
{
    [Theory]
    [InlineData(ModifierKeys.None, RangeSelectionGesture.Replace)]
    [InlineData(ModifierKeys.Control, RangeSelectionGesture.Toggle)]
    [InlineData(ModifierKeys.Shift, RangeSelectionGesture.Extend)]
    [InlineData(ModifierKeys.Control | ModifierKeys.Shift, RangeSelectionGesture.Extend)]
    public void ResolveGesture_MapsMouseSelectionModifiers(
        ModifierKeys modifiers,
        RangeSelectionGesture expectedGesture)
    {
        Assert.Equal(expectedGesture, SelectionInputService.ResolveGesture(modifiers));
    }

    [Fact]
    public void IsSelectAllGesture_RecognizesControlA()
    {
        Assert.True(SelectionInputService.IsSelectAllGesture(Key.A, Key.None, ModifierKeys.Control));
        Assert.True(SelectionInputService.IsSelectAllGesture(Key.None, Key.A, ModifierKeys.Control));
    }

    [Fact]
    public void IsSelectAllGesture_RejectsAWithoutControl()
    {
        Assert.False(SelectionInputService.IsSelectAllGesture(Key.A, Key.None, ModifierKeys.None));
    }

    [Fact]
    public void IsDeleteGesture_RecognizesPlainDelete()
    {
        Assert.True(SelectionInputService.IsDeleteGesture(Key.Delete, Key.None, ModifierKeys.None));
    }

    [Theory]
    [InlineData(Key.Back, Key.None, ModifierKeys.None)]
    [InlineData(Key.Delete, Key.None, ModifierKeys.Control)]
    [InlineData(Key.Delete, Key.None, ModifierKeys.Shift)]
    [InlineData(Key.None, Key.Delete, ModifierKeys.Alt)]
    public void IsDeleteGesture_RejectsNonPlainDelete(
        Key key,
        Key systemKey,
        ModifierKeys modifiers)
    {
        Assert.False(SelectionInputService.IsDeleteGesture(key, systemKey, modifiers));
    }

    [Theory]
    [InlineData(ModifierKeys.None, false)]
    [InlineData(ModifierKeys.Alt, false)]
    [InlineData(ModifierKeys.Control, true)]
    [InlineData(ModifierKeys.Shift, true)]
    [InlineData(ModifierKeys.Control | ModifierKeys.Shift, true)]
    public void HasRangeSelectionModifier_ReturnsTrueForMouseSelectionModifiers(
        ModifierKeys modifiers,
        bool expected)
    {
        Assert.Equal(expected, SelectionInputService.HasRangeSelectionModifier(modifiers));
    }
}
