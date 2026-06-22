using Fluxora.App.Models;
using Fluxora.App.Services;

namespace Fluxora.App.ViewModels;

public sealed class ModFileTreeNode
{
    private string? conflictText;

    private ModFileTreeNode(string name)
    {
        Name = name;
        IsPlaceholder = true;
    }

    public ModFileTreeNode(ModFileTreeEntry entry)
    {
        Name = string.IsNullOrWhiteSpace(entry.Name) ? entry.RelativePath : entry.Name;
        RelativePath = entry.RelativePath;
        IsDirectory = entry.IsDirectory;
        HasChildren = entry.HasChildren;
        Size = entry.Size;
        ConflictState = entry.ConflictState;
        ConflictOwners = entry.ConflictOwners;

        if (IsDirectory && HasChildren)
        {
            Children.Add(CreatePlaceholder());
        }
    }

    public string Name { get; }
    public string RelativePath { get; } = string.Empty;
    public bool IsDirectory { get; }
    public bool HasChildren { get; }
    public ulong Size { get; }
    public string ConflictState { get; } = string.Empty;
    public IReadOnlyList<string> ConflictOwners { get; } = Array.Empty<string>();
    public bool IsLoaded { get; set; }
    public bool IsPlaceholder { get; }
    public BulkObservableCollection<ModFileTreeNode> Children { get; } = new();

    public string IconText => IsDirectory ? "\uE8B7" : "\uE8A5";

    public string SizeText => IsDirectory ? string.Empty : FormatSize(Size);

    public string ConflictText
    {
        get
        {
            conflictText ??= BuildConflictText();
            return conflictText;
        }
    }

    public bool HasConflict => !string.IsNullOrWhiteSpace(ConflictState);

    public static ModFileTreeNode CreatePlaceholder()
    {
        return new ModFileTreeNode("Загрузка...");
    }

    public void ReplaceChildren(IEnumerable<ModFileTreeEntry> entries)
    {
        Children.ReplaceAll(entries.Select(entry => new ModFileTreeNode(entry)));
        IsLoaded = true;
    }

    private string BuildConflictText()
    {
        if (string.IsNullOrWhiteSpace(ConflictState))
        {
            return string.Empty;
        }

        string owners = ConflictOwners.Count == 0
            ? string.Empty
            : $" · {string.Join(", ", ConflictOwners)}";

        return ConflictState switch
        {
            "overwrites" => $"Перекрывает{owners}",
            "overwritten" => $"Перекрыт{owners}",
            "conflict" => $"Конфликт{owners}",
            _ => ConflictState
        };
    }

    private static string FormatSize(ulong bytes)
    {
        string[] units = new[] { "B", "KB", "MB", "GB" };
        double value = bytes;
        int unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            ++unit;
        }

        return $"{value:0.#} {units[unit]}";
    }
}
