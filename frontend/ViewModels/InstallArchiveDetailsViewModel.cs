using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using Fluxora.App.Models;

namespace Fluxora.App.ViewModels;

public sealed class InstallArchiveDetailsViewModel : INotifyPropertyChanged
{
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

    public int ChangedFileCount => Flatten(Roots).Count(node => node.IsFile && node.HasOverride);

    public string ChangeSummaryText => ChangedFileCount == 0
        ? "Ручных изменений нет."
        : $"Изменено вручную: {ChangedFileCount}.";

    public event PropertyChangedEventHandler? PropertyChanged;

    public IReadOnlyList<PlacementOverride> CreatePlacementOverrides()
    {
        List<PlacementOverride> overrides = new();
        foreach (InstallArchiveFileNode node in Flatten(Roots))
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

        OnPropertyChanged(nameof(ChangedFileCount));
        OnPropertyChanged(nameof(ChangeSummaryText));
        return true;
    }

    public void ResetTargets()
    {
        UnsubscribeNodes(Roots);
        Roots.Clear();
        foreach (InstallArchiveFileNode node in BuildTree(Preview))
        {
            Roots.Add(node);
        }

        SubscribeNodes(Roots);
        OnPropertyChanged(nameof(ChangedFileCount));
        OnPropertyChanged(nameof(ChangeSummaryText));
    }

    public void SetFolderDropHover(InstallArchiveFileNode? folder)
    {
        foreach (InstallArchiveFileNode node in Flatten(Roots).Where(node => node.IsDirectory))
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
        foreach (InstallArchiveFileNode node in Flatten(nodes))
        {
            node.PropertyChanged += OnNodePropertyChanged;
        }
    }

    private void UnsubscribeNodes(IEnumerable<InstallArchiveFileNode> nodes)
    {
        foreach (InstallArchiveFileNode node in Flatten(nodes))
        {
            node.PropertyChanged -= OnNodePropertyChanged;
        }
    }

    private void OnNodePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(InstallArchiveFileNode.SelectedTarget) &&
            e.PropertyName != nameof(InstallArchiveFileNode.SelectedTargetRelativePath) &&
            e.PropertyName != nameof(InstallArchiveFileNode.HasOverride))
        {
            return;
        }

        OnPropertyChanged(nameof(ChangedFileCount));
        OnPropertyChanged(nameof(ChangeSummaryText));
    }

    private static ObservableCollection<InstallArchiveFileNode> BuildTree(ContentLayoutPreview preview)
    {
        InstallArchiveFileNode root = new("archive", string.Empty, false, string.Empty, string.Empty);
        Dictionary<string, InstallArchiveFileNode> directories = new(StringComparer.OrdinalIgnoreCase)
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

            InstallArchiveFileNode parent = root;
            for (int index = 0; index < parts.Length - 1; index++)
            {
                string folderRelativePath = FolderRelativePathForDisplay(entry.Target, parts, index);
                string key = DirectoryKey(entry.Target, folderRelativePath);
                if (!directories.TryGetValue(key, out InstallArchiveFileNode? directory))
                {
                    directory = new InstallArchiveFileNode(
                        parts[index],
                        string.Empty,
                        false,
                        entry.Target,
                        folderRelativePath);
                    directories[key] = directory;
                    parent.AddChild(directory);
                }

                parent = directory;
            }

            string sourcePath = NormalizePath(entry.SourcePath);
            parent.AddChild(InstallArchiveFileNode.FromEntry(parts[^1], sourcePath, entry));
        }

        SortTree(root.Children);
        return root.Children;
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

    private static void SortTree(ObservableCollection<InstallArchiveFileNode> nodes)
    {
        List<InstallArchiveFileNode> sorted = nodes
            .OrderByDescending(node => node.IsDirectory)
            .ThenBy(node => node.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        nodes.Clear();
        foreach (InstallArchiveFileNode node in sorted)
        {
            SortTree(node.Children);
            nodes.Add(node);
        }
    }

    private static IEnumerable<InstallArchiveFileNode> Flatten(IEnumerable<InstallArchiveFileNode> nodes)
    {
        foreach (InstallArchiveFileNode node in nodes)
        {
            yield return node;
            foreach (InstallArchiveFileNode child in Flatten(node.Children))
            {
                yield return child;
            }
        }
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

public sealed class InstallArchiveFileNode : INotifyPropertyChanged
{
    private string selectedTarget;
    private string selectedTargetRelativePath;
    private bool isDragOver;

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
        IReadOnlyList<PlacementTargetChoice> targetChoices)
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
                return Children.Count == 1 ? "1 элемент" : $"{Children.Count} элементов";
            }

            string classification = string.IsNullOrWhiteSpace(Classification)
                ? "file"
                : Classification;
            return $"{classification} -> {DestinationText}";
        }
    }

    public ObservableCollection<InstallArchiveFileNode> Children { get; } = new();

    public InstallArchiveFileNode? Parent { get; internal set; }

    public event PropertyChangedEventHandler? PropertyChanged;

    public static InstallArchiveFileNode FromEntry(string name, string sourcePath, ContentLayoutPreviewEntry entry)
    {
        IReadOnlyList<PlacementTargetChoice> choices = BuildTargetChoices(entry);
        string targetRelativePath = NormalizePath(entry.TargetRelativePath);
        return new InstallArchiveFileNode(
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
        OnPropertyChanged(nameof(MetadataText));
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
