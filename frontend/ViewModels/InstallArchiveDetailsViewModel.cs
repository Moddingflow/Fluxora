using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using Fluxora.App.Models;

namespace Fluxora.App.ViewModels;

public sealed class InstallArchiveDetailsViewModel : INotifyPropertyChanged
{
    private readonly HashSet<InstallArchiveFileNode> subscribedNodes = new();
    private int changedFileCount;

    public InstallArchiveDetailsViewModel(ContentLayoutPreview preview)
    {
        Preview = preview;
        SummaryText = BuildSummaryText(preview);
        Roots = BuildTree(preview);
        Findings = preview.ValidationFindings;
        SubscribeNodes(Roots);
    }

    public ContentLayoutPreview Preview { get; }

    public string SummaryText { get; }

    public ObservableCollection<InstallArchiveFileNode> Roots { get; }

    public IReadOnlyList<ContentLayoutFinding> Findings { get; }

    public bool HasFindings => Findings.Count > 0;

    public int ChangedFileCount => changedFileCount;

    public string ChangeSummaryText => ChangedFileCount == 0
        ? "Ручных изменений нет."
        : $"Изменено вручную: {ChangedFileCount}.";

    public event PropertyChangedEventHandler? PropertyChanged;

    public IReadOnlyList<PlacementOverride> CreatePlacementOverrides()
    {
        List<PlacementOverride> overrides = new();
        foreach (InstallArchiveFileNode node in subscribedNodes)
        {
            if (!node.IsFile ||
                string.IsNullOrWhiteSpace(node.SourcePath) ||
                !node.HasOverride)
            {
                continue;
            }

            overrides.Add(new PlacementOverride
            {
                SourcePath = node.SourcePath,
                Target = node.SelectedTarget,
                TargetRelativePath = node.SelectedTargetRelativePath
            });
        }

        return overrides;
    }

    public bool CanStartDrag(InstallArchiveFileNode node)
    {
        return node.IsFile &&
            node.ManualOverrideAllowed &&
            node.TargetChoices.Count > 0;
    }

    public bool CanMoveNodeToFolder(InstallArchiveFileNode node, InstallArchiveFileNode folder)
    {
        if (!CanStartDrag(node) ||
            !folder.CanAcceptDrops ||
            !node.TargetChoices.Any(choice =>
                string.Equals(choice.Target, folder.SelectedTarget, StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        string targetRelativePath = BuildChildRelativePath(folder.SelectedTargetRelativePath, node.Name);
        if (string.IsNullOrWhiteSpace(targetRelativePath) ||
            (string.Equals(node.SelectedTarget, folder.SelectedTarget, StringComparison.OrdinalIgnoreCase) &&
             string.Equals(node.SelectedTargetRelativePath, targetRelativePath, StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        return !folder.Children.Any(child =>
            !ReferenceEquals(child, node) &&
            string.Equals(child.Name, node.Name, StringComparison.OrdinalIgnoreCase));
    }

    public bool MoveNodeToFolder(InstallArchiveFileNode node, InstallArchiveFileNode folder)
    {
        if (!CanMoveNodeToFolder(node, folder))
        {
            return false;
        }

        InstallArchiveFileNode? oldParent = node.Parent;
        ObservableCollection<InstallArchiveFileNode> oldCollection = oldParent?.Children ?? Roots;
        if (!oldCollection.Remove(node))
        {
            return false;
        }

        oldParent?.NotifyChildrenChanged();

        node.SelectedTarget = folder.SelectedTarget;
        node.SelectedTargetRelativePath = BuildChildRelativePath(folder.SelectedTargetRelativePath, node.Name);
        folder.AddChildSorted(node);
        folder.NotifyChildrenChanged();

        NotifyChangeSummaryChanged();
        return true;
    }

    public void ResetTargets()
    {
        UnsubscribeNodes();
        Roots.Clear();
        foreach (InstallArchiveFileNode node in BuildTree(Preview))
        {
            Roots.Add(node);
        }

        SubscribeNodes(Roots);
        changedFileCount = 0;
        NotifyChangeSummaryChanged();
    }

    public void SetFolderDropHover(InstallArchiveFileNode? folder)
    {
        foreach (InstallArchiveFileNode node in subscribedNodes.Where(node => node.IsDirectory))
        {
            node.IsDragOver = ReferenceEquals(node, folder);
        }
    }

    public void ClearFolderDropHover()
    {
        SetFolderDropHover(null);
    }

    private void SubscribeNodes(IEnumerable<InstallArchiveFileNode> nodes)
    {
        foreach (InstallArchiveFileNode node in nodes)
        {
            SubscribeNode(node);
        }
    }

    private void SubscribeNode(InstallArchiveFileNode node)
    {
        if (!subscribedNodes.Add(node))
        {
            return;
        }

        node.PropertyChanged += OnNodePropertyChanged;
        node.ChildrenMaterialized += OnNodeChildrenMaterialized;
        if (node.MaterializedChildren is not null)
        {
            SubscribeNodes(node.MaterializedChildren);
        }
    }

    private void UnsubscribeNodes()
    {
        foreach (InstallArchiveFileNode node in subscribedNodes)
        {
            node.PropertyChanged -= OnNodePropertyChanged;
            node.ChildrenMaterialized -= OnNodeChildrenMaterialized;
        }

        subscribedNodes.Clear();
    }

    private void OnNodeChildrenMaterialized(
        InstallArchiveFileNode node,
        IReadOnlyList<InstallArchiveFileNode> children)
    {
        SubscribeNodes(children);
    }

    private void OnNodePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(InstallArchiveFileNode.HasOverride))
        {
            return;
        }

        NotifyChangeSummaryChanged();
    }

    private void NotifyChangeSummaryChanged()
    {
        changedFileCount = subscribedNodes.Count(node => node.IsFile && node.HasOverride);
        OnPropertyChanged(nameof(ChangedFileCount));
        OnPropertyChanged(nameof(ChangeSummaryText));
    }

    private static ObservableCollection<InstallArchiveFileNode> BuildTree(ContentLayoutPreview preview)
    {
        InstallArchiveNodeDescriptor root = InstallArchiveNodeDescriptor.CreateDirectory(
            "archive",
            string.Empty,
            string.Empty);
        Dictionary<string, InstallArchiveNodeDescriptor> directories = new(StringComparer.OrdinalIgnoreCase)
        {
            [DirectoryKey(string.Empty, string.Empty)] = root
        };

        foreach (ContentLayoutPreviewEntry entry in preview.Entries.OrderBy(entry => entry.SourcePath, StringComparer.OrdinalIgnoreCase))
        {
            string displayPath = BuildDisplayPath(entry);
            if (string.IsNullOrWhiteSpace(displayPath))
            {
                continue;
            }

            string[] parts = displayPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                continue;
            }

            InstallArchiveNodeDescriptor parent = root;
            for (int index = 0; index < parts.Length - 1; index++)
            {
                string folderRelativePath = FolderRelativePathForDisplay(entry.Target, parts, index);
                string key = DirectoryKey(entry.Target, folderRelativePath);
                if (!directories.TryGetValue(key, out InstallArchiveNodeDescriptor? directory))
                {
                    directory = InstallArchiveNodeDescriptor.CreateDirectory(
                        parts[index],
                        entry.Target,
                        folderRelativePath);
                    directories[key] = directory;
                    parent.Children.Add(directory);
                }

                parent = directory;
            }

            string sourcePath = NormalizePath(entry.SourcePath);
            parent.Children.Add(InstallArchiveNodeDescriptor.CreateFile(parts[^1], sourcePath, entry));
        }

        SortTree(root.Children);
        return CreateNodes(root.Children, null);
    }

    private static string BuildDisplayPath(ContentLayoutPreviewEntry entry)
    {
        string targetRelativePath = NormalizePath(entry.TargetRelativePath);
        string fallbackPath = NormalizePath(entry.SourcePath);

        return entry.Target switch
        {
            "data" => string.IsNullOrWhiteSpace(targetRelativePath)
                ? "Data"
                : $"Data/{targetRelativePath}",
            "gameRoot" => string.IsNullOrWhiteSpace(targetRelativePath)
                ? fallbackPath
                : targetRelativePath,
            "profile" => string.IsNullOrWhiteSpace(targetRelativePath)
                ? "Профиль"
                : $"Профиль/{targetRelativePath}",
            "overwrite" => string.IsNullOrWhiteSpace(targetRelativePath)
                ? "Overwrite"
                : $"Overwrite/{targetRelativePath}",
            "blocked" => string.IsNullOrWhiteSpace(fallbackPath)
                ? "Blocked"
                : $"Blocked/{fallbackPath}",
            _ => string.IsNullOrWhiteSpace(targetRelativePath)
                ? fallbackPath
                : $"{DisplayNameForTarget(entry.Target)}/{targetRelativePath}"
        };
    }

    private static string FolderRelativePathForDisplay(string target, IReadOnlyList<string> parts, int directoryIndex)
    {
        int firstRelativePart = target is "data" or "profile" or "overwrite" or "blocked"
            ? 1
            : 0;
        if (directoryIndex < firstRelativePart)
        {
            return string.Empty;
        }

        return string.Join("/", parts.Skip(firstRelativePart).Take(directoryIndex - firstRelativePart + 1));
    }

    private static ObservableCollection<InstallArchiveFileNode> CreateNodes(
        IReadOnlyList<InstallArchiveNodeDescriptor> descriptors,
        InstallArchiveFileNode? parent)
    {
        ObservableCollection<InstallArchiveFileNode> nodes = new();
        foreach (InstallArchiveNodeDescriptor descriptor in descriptors)
        {
            nodes.Add(InstallArchiveFileNode.FromDescriptor(descriptor, parent));
        }

        return nodes;
    }

    private static void SortTree(List<InstallArchiveNodeDescriptor> nodes)
    {
        List<InstallArchiveNodeDescriptor> sorted = nodes
            .OrderByDescending(node => node.IsDirectory)
            .ThenBy(node => node.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        nodes.Clear();
        foreach (InstallArchiveNodeDescriptor node in sorted)
        {
            SortTree(node.Children);
        }

        nodes.AddRange(sorted);
    }

    private static string DirectoryKey(string target, string relativePath)
    {
        return $"{target}|{NormalizePath(relativePath)}";
    }

    private static string BuildChildRelativePath(string folderRelativePath, string childName)
    {
        string normalizedFolder = NormalizePath(folderRelativePath);
        return string.IsNullOrWhiteSpace(normalizedFolder)
            ? childName
            : $"{normalizedFolder}/{childName}";
    }

    private static string NormalizePath(string path)
    {
        return path.Replace(Path.DirectorySeparatorChar, '/')
            .Replace(Path.AltDirectorySeparatorChar, '/')
            .Trim('/');
    }

    private static string BuildSummaryText(ContentLayoutPreview preview)
    {
        string game = string.IsNullOrWhiteSpace(preview.GameDisplayName)
            ? preview.GameId
            : preview.GameDisplayName;
        string summary = string.IsNullOrWhiteSpace(preview.ExplanationSummary)
            ? "Fluxora построила план размещения."
            : preview.ExplanationSummary;

        return string.IsNullOrWhiteSpace(game)
            ? $"{summary} Файлов: {preview.Summary.TotalEntries}."
            : $"{summary} Игра: {game}. Файлов: {preview.Summary.TotalEntries}.";
    }

    private static string DisplayNameForTarget(string target)
    {
        return target switch
        {
            "gameRoot" => "gameRoot",
            "data" => "Data",
            "profile" => "Профиль",
            "overwrite" => "Overwrite",
            "blocked" => "Blocked",
            _ => target
        };
    }

    private void OnPropertyChanged(string propertyName)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

internal sealed class InstallArchiveNodeDescriptor
{
    private InstallArchiveNodeDescriptor(
        string name,
        string sourcePath,
        bool isFile,
        string selectedTarget,
        string selectedTargetRelativePath,
        ContentLayoutPreviewEntry? entry)
    {
        Name = name;
        SourcePath = sourcePath;
        IsFile = isFile;
        SelectedTarget = selectedTarget;
        SelectedTargetRelativePath = selectedTargetRelativePath;
        Entry = entry;
    }

    public string Name { get; }

    public string SourcePath { get; }

    public bool IsFile { get; }

    public bool IsDirectory => !IsFile;

    public string SelectedTarget { get; }

    public string SelectedTargetRelativePath { get; }

    public ContentLayoutPreviewEntry? Entry { get; }

    public List<InstallArchiveNodeDescriptor> Children { get; } = new();

    public static InstallArchiveNodeDescriptor CreateDirectory(
        string name,
        string selectedTarget,
        string selectedTargetRelativePath)
    {
        return new InstallArchiveNodeDescriptor(
            name,
            string.Empty,
            false,
            selectedTarget,
            selectedTargetRelativePath,
            null);
    }

    public static InstallArchiveNodeDescriptor CreateFile(
        string name,
        string sourcePath,
        ContentLayoutPreviewEntry entry)
    {
        return new InstallArchiveNodeDescriptor(
            name,
            sourcePath,
            true,
            entry.Target,
            entry.TargetRelativePath,
            entry);
    }
}

public sealed class InstallArchiveFileNode : INotifyPropertyChanged
{
    private string selectedTarget;
    private string selectedTargetRelativePath;
    private bool isDragOver;
    private readonly IReadOnlyList<InstallArchiveNodeDescriptor> childDescriptors;
    private ObservableCollection<InstallArchiveFileNode>? children;
    private int childCount;

    private InstallArchiveFileNode(
        string name,
        string sourcePath,
        bool isFile,
        string originalTarget,
        string selectedTarget,
        string originalTargetRelativePath,
        string selectedTargetRelativePath,
        string classification,
        string explanation,
        bool manualOverrideAllowed,
        IReadOnlyList<PlacementTargetChoice> targetChoices,
        IReadOnlyList<InstallArchiveNodeDescriptor>? childDescriptors = null)
    {
        Name = name;
        SourcePath = sourcePath;
        IsFile = isFile;
        OriginalTarget = originalTarget;
        this.selectedTarget = selectedTarget;
        OriginalTargetRelativePath = originalTargetRelativePath;
        this.selectedTargetRelativePath = selectedTargetRelativePath;
        Classification = classification;
        Explanation = explanation;
        ManualOverrideAllowed = manualOverrideAllowed;
        TargetChoices = targetChoices;
        this.childDescriptors = childDescriptors ?? Array.Empty<InstallArchiveNodeDescriptor>();
        childCount = this.childDescriptors.Count;
    }

    public InstallArchiveFileNode(
        string name,
        string sourcePath,
        bool isFile,
        string selectedTarget,
        string selectedTargetRelativePath)
        : this(
            name,
            sourcePath,
            isFile,
            selectedTarget,
            selectedTarget,
            selectedTargetRelativePath,
            selectedTargetRelativePath,
            string.Empty,
            string.Empty,
            false,
            Array.Empty<PlacementTargetChoice>())
    {
    }

    public string Name { get; }

    public string SourcePath { get; }

    public bool IsFile { get; }

    public bool IsDirectory => !IsFile;

    public string OriginalTarget { get; }

    public string SelectedTarget
    {
        get => selectedTarget;
        set
        {
            if (string.Equals(selectedTarget, value, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            selectedTarget = value;
            OnPropertyChanged(nameof(SelectedTarget));
            OnPropertyChanged(nameof(DestinationText));
            OnPropertyChanged(nameof(MetadataText));
            OnPropertyChanged(nameof(HasOverride));
        }
    }

    public string OriginalTargetRelativePath { get; }

    public string SelectedTargetRelativePath
    {
        get => selectedTargetRelativePath;
        set
        {
            string normalized = NormalizePath(value);
            if (string.Equals(selectedTargetRelativePath, normalized, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            selectedTargetRelativePath = normalized;
            OnPropertyChanged(nameof(SelectedTargetRelativePath));
            OnPropertyChanged(nameof(DestinationText));
            OnPropertyChanged(nameof(MetadataText));
            OnPropertyChanged(nameof(HasOverride));
        }
    }

    public string Classification { get; }

    public string Explanation { get; }

    public bool ManualOverrideAllowed { get; }

    public IReadOnlyList<PlacementTargetChoice> TargetChoices { get; }

    public bool CanChooseTarget => IsFile && ManualOverrideAllowed && TargetChoices.Count > 1;

    public bool CanAcceptDrops => IsDirectory &&
        !string.IsNullOrWhiteSpace(SelectedTarget) &&
        !string.Equals(SelectedTarget, "blocked", StringComparison.OrdinalIgnoreCase);

    public bool HasOverride => IsFile &&
        (!string.Equals(SelectedTarget, OriginalTarget, StringComparison.OrdinalIgnoreCase) ||
         !string.Equals(SelectedTargetRelativePath, OriginalTargetRelativePath, StringComparison.OrdinalIgnoreCase));

    public bool IsDragOver
    {
        get => isDragOver;
        set
        {
            if (isDragOver == value)
            {
                return;
            }

            isDragOver = value;
            OnPropertyChanged(nameof(IsDragOver));
        }
    }

    public string DestinationText => IsFile
        ? FormatDestination(SelectedTarget, SelectedTargetRelativePath)
        : string.Empty;

    public string MetadataText
    {
        get
        {
            if (!IsFile)
            {
                return childCount == 1 ? "1 элемент" : $"{childCount} элементов";
            }

            string classification = string.IsNullOrWhiteSpace(Classification)
                ? "file"
                : Classification;
            return $"{classification} -> {DestinationText}";
        }
    }

    public ObservableCollection<InstallArchiveFileNode> Children => children ??= MaterializeChildren();

    internal ObservableCollection<InstallArchiveFileNode>? MaterializedChildren => children;

    internal bool AreChildrenMaterialized => children is not null;

    public InstallArchiveFileNode? Parent { get; internal set; }

    public event PropertyChangedEventHandler? PropertyChanged;

    internal event Action<InstallArchiveFileNode, IReadOnlyList<InstallArchiveFileNode>>? ChildrenMaterialized;

    public static InstallArchiveFileNode FromEntry(string name, string sourcePath, ContentLayoutPreviewEntry entry)
    {
        return FromEntry(name, sourcePath, entry, null);
    }

    internal static InstallArchiveFileNode FromDescriptor(
        InstallArchiveNodeDescriptor descriptor,
        InstallArchiveFileNode? parent)
    {
        if (descriptor.IsFile && descriptor.Entry is not null)
        {
            return FromEntry(descriptor.Name, descriptor.SourcePath, descriptor.Entry, parent);
        }

        InstallArchiveFileNode node = new(
            descriptor.Name,
            string.Empty,
            false,
            descriptor.SelectedTarget,
            descriptor.SelectedTarget,
            descriptor.SelectedTargetRelativePath,
            descriptor.SelectedTargetRelativePath,
            string.Empty,
            string.Empty,
            false,
            Array.Empty<PlacementTargetChoice>(),
            childDescriptors: descriptor.Children);
        node.Parent = parent;
        return node;
    }

    private static InstallArchiveFileNode FromEntry(
        string name,
        string sourcePath,
        ContentLayoutPreviewEntry entry,
        InstallArchiveFileNode? parent)
    {
        IReadOnlyList<PlacementTargetChoice> choices = BuildTargetChoices(entry);
        string targetRelativePath = NormalizePath(entry.TargetRelativePath);
        InstallArchiveFileNode node = new(
            name,
            sourcePath,
            true,
            entry.Target,
            entry.Target,
            targetRelativePath,
            targetRelativePath,
            entry.Classification,
            entry.Explanation,
            entry.ManualOverrideAllowed,
            choices);
        node.Parent = parent;
        return node;
    }

    public void AddChild(InstallArchiveFileNode child)
    {
        child.Parent = this;
        Children.Add(child);
        NotifyChildrenChanged();
    }

    public void AddChildSorted(InstallArchiveFileNode child)
    {
        child.Parent = this;
        int index = 0;
        while (index < Children.Count && CompareNodeOrder(Children[index], child) <= 0)
        {
            index++;
        }

        Children.Insert(index, child);
        NotifyChildrenChanged();
    }

    public void ResetTarget()
    {
        SelectedTarget = OriginalTarget;
        SelectedTargetRelativePath = OriginalTargetRelativePath;
    }

    internal void NotifyChildrenChanged()
    {
        if (children is not null)
        {
            childCount = children.Count;
        }

        OnPropertyChanged(nameof(MetadataText));
    }

    private ObservableCollection<InstallArchiveFileNode> MaterializeChildren()
    {
        ObservableCollection<InstallArchiveFileNode> materialized = new();
        foreach (InstallArchiveNodeDescriptor descriptor in childDescriptors)
        {
            materialized.Add(FromDescriptor(descriptor, this));
        }

        childCount = materialized.Count;
        ChildrenMaterialized?.Invoke(this, materialized);
        return materialized;
    }

    private static IReadOnlyList<PlacementTargetChoice> BuildTargetChoices(ContentLayoutPreviewEntry entry)
    {
        IEnumerable<string> targets = entry.ManualOverrideAllowed
            ? entry.SafeManualTargets.Prepend(entry.Target)
            : new[] { entry.Target };

        return targets
            .Where(target => !string.IsNullOrWhiteSpace(target))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(target => new PlacementTargetChoice(target, DisplayNameForTarget(target)))
            .ToList();
    }

    private static int CompareNodeOrder(InstallArchiveFileNode left, InstallArchiveFileNode right)
    {
        int directoryCompare = right.IsDirectory.CompareTo(left.IsDirectory);
        return directoryCompare != 0
            ? directoryCompare
            : string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase);
    }

    private static string FormatDestination(string target, string relativePath)
    {
        string display = DisplayNameForTarget(target);
        return string.IsNullOrWhiteSpace(relativePath)
            ? display
            : $"{display}/{relativePath}";
    }

    private static string DisplayNameForTarget(string target)
    {
        return target switch
        {
            "gameRoot" => "gameRoot",
            "data" => "Data",
            "profile" => "Профиль",
            "overwrite" => "Overwrite",
            "blocked" => "Blocked",
            _ => target
        };
    }

    private static string NormalizePath(string path)
    {
        return path.Replace(Path.DirectorySeparatorChar, '/')
            .Replace(Path.AltDirectorySeparatorChar, '/')
            .Trim('/');
    }

    private void OnPropertyChanged(string propertyName)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

public sealed class PlacementTargetChoice
{
    public PlacementTargetChoice(string target, string displayName)
    {
        Target = target;
        DisplayName = displayName;
    }

    public string Target { get; }

    public string DisplayName { get; }
}
