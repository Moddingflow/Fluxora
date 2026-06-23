namespace Fluxora.App.Tests;

public static class TestCollections
{
    public const string WpfApplication = "WPF application";
}

[CollectionDefinition(TestCollections.WpfApplication, DisableParallelization = true)]
public sealed class WpfApplicationTestCollection
{
}
