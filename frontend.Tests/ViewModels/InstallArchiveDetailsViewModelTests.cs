using Fluxora.App.Models;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.ViewModels;

public sealed class InstallArchiveDetailsViewModelTests
{
    [Fact]
    public void CreatePlacementOverrides_ReturnsChangedFileTargetAndPath()
    {
        InstallArchiveDetailsViewModel viewModel = new(CreatePreview());
        InstallArchiveFileNode file = FindNode(viewModel.Roots, "SkyUI_SE.esp");
        InstallArchiveFileNode textures = FindNode(viewModel.Roots, "textures");

        Assert.True(viewModel.MoveNodeToFolder(file, textures));

        PlacementOverride placement = Assert.Single(viewModel.CreatePlacementOverrides());
        Assert.Equal("Data/SkyUI_SE.esp", placement.SourcePath);
        Assert.Equal("data", placement.Target);
        Assert.Equal("textures/SkyUI_SE.esp", placement.TargetRelativePath);
    }

    [Fact]
    public void ResetTargets_ClearsManualOverridesAndRestoresTree()
    {
        InstallArchiveDetailsViewModel viewModel = new(CreatePreview());
        InstallArchiveFileNode file = FindNode(viewModel.Roots, "SkyUI_SE.esp");
        InstallArchiveFileNode textures = FindNode(viewModel.Roots, "textures");
        Assert.True(viewModel.MoveNodeToFolder(file, textures));

        viewModel.ResetTargets();

        InstallArchiveFileNode restoredFile = FindNode(viewModel.Roots, "SkyUI_SE.esp");
        Assert.Empty(viewModel.CreatePlacementOverrides());
        Assert.Equal("data", restoredFile.SelectedTarget);
        Assert.Equal("SkyUI_SE.esp", restoredFile.SelectedTargetRelativePath);
        Assert.Equal(0, viewModel.ChangedFileCount);
    }

    [Fact]
    public void ReadOnlyEntriesExposeSingleDestinationChoiceButCannotDrag()
    {
        ContentLayoutPreview preview = CreatePreview();
        preview.Entries[0].ManualOverrideAllowed = false;
        preview.Entries[0].SafeManualTargets.Clear();

        InstallArchiveDetailsViewModel viewModel = new(preview);
        InstallArchiveFileNode file = FindNode(viewModel.Roots, "SkyUI_SE.esp");

        Assert.False(file.CanChooseTarget);
        Assert.False(viewModel.CanStartDrag(file));
        PlacementTargetChoice choice = Assert.Single(file.TargetChoices);
        Assert.Equal("data", choice.Target);
    }

    [Fact]
    public void MoveNodeToFolder_UpdatesFileTargetRelativePathAndTree()
    {
        InstallArchiveDetailsViewModel viewModel = new(CreatePreview());
        InstallArchiveFileNode file = FindNode(viewModel.Roots, "SkyUI_SE.esp");
        InstallArchiveFileNode interfaceFolder = FindNode(viewModel.Roots, "interface");

        Assert.True(viewModel.MoveNodeToFolder(file, interfaceFolder));

        Assert.Equal("data", file.SelectedTarget);
        Assert.Equal("textures/interface/SkyUI_SE.esp", file.SelectedTargetRelativePath);
        Assert.Contains(file, interfaceFolder.Children);
        Assert.Equal(1, viewModel.ChangedFileCount);
    }

    [Fact]
    public void MoveNodeToFolder_RejectsUnsafeTarget()
    {
        ContentLayoutPreview preview = CreatePreview();
        preview.Entries.Add(new ContentLayoutPreviewEntry
        {
            SourcePath = "profiles/settings.ini",
            Target = "profile",
            TargetRelativePath = "settings.ini",
            Classification = "ini",
            Explanation = "Profile config.",
            ManualOverrideAllowed = true,
            SafeManualTargets = { "profile" }
        });
        InstallArchiveDetailsViewModel viewModel = new(preview);
        InstallArchiveFileNode file = FindNode(viewModel.Roots, "SkyUI_SE.esp");
        InstallArchiveFileNode profile = FindNode(viewModel.Roots, "Профиль");

        Assert.False(viewModel.CanMoveNodeToFolder(file, profile));
        Assert.False(viewModel.MoveNodeToFolder(file, profile));
        Assert.Empty(viewModel.CreatePlacementOverrides());
        Assert.Equal("SkyUI_SE.esp", file.SelectedTargetRelativePath);
    }

    [Fact]
    public void MoveNodeToFolder_RejectsDuplicateFileNameInTargetFolder()
    {
        ContentLayoutPreview preview = CreatePreview();
        preview.Entries.Add(new ContentLayoutPreviewEntry
        {
            SourcePath = "Data/textures/SkyUI_SE.esp",
            Target = "data",
            TargetRelativePath = "textures/SkyUI_SE.esp",
            Classification = "plugin",
            Explanation = "Duplicate name in folder.",
            ManualOverrideAllowed = true,
            SafeManualTargets = { "data", "gameRoot" }
        });
        InstallArchiveDetailsViewModel viewModel = new(preview);
        InstallArchiveFileNode file = FindTopLevelFile(viewModel.Roots, "SkyUI_SE.esp");
        InstallArchiveFileNode textures = FindNode(viewModel.Roots, "textures");

        Assert.False(viewModel.CanMoveNodeToFolder(file, textures));
        Assert.False(viewModel.MoveNodeToFolder(file, textures));
        Assert.Empty(viewModel.CreatePlacementOverrides());
    }

    [Fact]
    public void DirectoryMetadata_DoesNotMaterializeLazyChildren()
    {
        InstallArchiveDetailsViewModel viewModel = new(CreatePreview());
        InstallArchiveFileNode data = Assert.Single(viewModel.Roots, node => node.Name == "Data");

        Assert.False(data.AreChildrenMaterialized);
        Assert.Equal("2 элементов", data.MetadataText);
        Assert.False(data.AreChildrenMaterialized);

        Assert.Equal(2, data.Children.Count);
        Assert.True(data.AreChildrenMaterialized);
    }

    private static ContentLayoutPreview CreatePreview()
    {
        return new ContentLayoutPreview
        {
            GameId = "skyrimse",
            GameDisplayName = "Skyrim Special Edition",
            CanInstall = true,
            Summary = new ContentLayoutPreviewSummary
            {
                TotalEntries = 2,
                PlannedEntries = 2
            },
            Entries =
            {
                new ContentLayoutPreviewEntry
                {
                    SourcePath = "Data/SkyUI_SE.esp",
                    Target = "data",
                    TargetRelativePath = "SkyUI_SE.esp",
                    Classification = "plugin",
                    Explanation = "Plugin extension matches.",
                    ManualOverrideAllowed = true,
                    SafeManualTargets = { "data", "gameRoot" }
                },
                new ContentLayoutPreviewEntry
                {
                    SourcePath = "Data/textures/interface/widget.dds",
                    Target = "data",
                    TargetRelativePath = "textures/interface/widget.dds",
                    Classification = "gameData",
                    Explanation = "Game data path.",
                    ManualOverrideAllowed = true,
                    SafeManualTargets = { "data", "gameRoot" }
                }
            }
        };
    }

    private static InstallArchiveFileNode FindTopLevelFile(IEnumerable<InstallArchiveFileNode> nodes, string name)
    {
        InstallArchiveFileNode data = FindNode(nodes, "Data");
        InstallArchiveFileNode? match = data.Children.FirstOrDefault(node => node.IsFile && node.Name == name);
        return match ?? throw new InvalidOperationException($"Top-level file was not found: {name}");
    }

    private static InstallArchiveFileNode FindNode(IEnumerable<InstallArchiveFileNode> nodes, string name)
    {
        foreach (InstallArchiveFileNode node in nodes)
        {
            if (node.Name == name)
            {
                return node;
            }

            InstallArchiveFileNode? child = TryFindNode(node.Children, name);
            if (child is not null)
            {
                return child;
            }
        }

        throw new InvalidOperationException($"Node was not found: {name}");
    }

    private static InstallArchiveFileNode? TryFindNode(IEnumerable<InstallArchiveFileNode> nodes, string name)
    {
        foreach (InstallArchiveFileNode node in nodes)
        {
            if (node.Name == name)
            {
                return node;
            }

            InstallArchiveFileNode? child = TryFindNode(node.Children, name);
            if (child is not null)
            {
                return child;
            }
        }

        return null;
    }
}
