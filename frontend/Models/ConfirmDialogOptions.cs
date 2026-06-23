using System.Windows;
using System.Windows.Media;

namespace Fluxora.App.Models;

/// <summary>
/// One labelled fact shown inside a confirmation dialog (for example the build folder or the
/// config path). Purely presentational data — the icon is resolved from the shared icon set.
/// </summary>
public sealed class ConfirmDialogDetail
{
    public required Geometry? Icon { get; init; }
    public required string Label { get; init; }
    public required string Value { get; init; }

    /// <summary>Resolves a geometry from the merged <c>Icons.xaml</c> resource dictionary.</summary>
    public static Geometry? IconFromResource(string key)
    {
        return System.Windows.Application.Current?.TryFindResource(key) as Geometry;
    }
}

/// <summary>
/// Describes the content of a <see cref="ConfirmDialogWindow"/>. Holds only display text and the
/// facts to surface; it carries no behaviour, so the same window can back any confirmation.
/// </summary>
public sealed class ConfirmDialogOptions
{
    public required string Heading { get; init; }

    /// <summary>Body sentence. The <see cref="Highlight"/> substring is emphasised when present.</summary>
    public required string Message { get; init; }

    /// <summary>Optional substring of <see cref="Message"/> to render bold (e.g. the build name).</summary>
    public string? Highlight { get; init; }

    public IReadOnlyList<ConfirmDialogDetail> Details { get; init; } = Array.Empty<ConfirmDialogDetail>();

    public required string ConfirmText { get; init; }

    public string CancelText { get; init; } = "Отмена";

    /// <summary>When true the dialog uses the destructive (red) accent for the confirm action.</summary>
    public bool IsDestructive { get; init; }

    /// <summary>Confirmation for permanently deleting a build from disk.</summary>
    public static ConfirmDialogOptions DeleteBuild(ModProject project)
    {
        List<ConfirmDialogDetail> details = new()
        {
            new ConfirmDialogDetail
            {
                Icon = ConfirmDialogDetail.IconFromResource("Icon.Folder"),
                Label = "Папка сборки",
                Value = project.ProjectDirectory
            }
        };

        return new ConfirmDialogOptions
        {
            Heading = "Удалить сборку?",
            Message = $"«{project.Name}» и все её файлы будут безвозвратно удалены с диска. Отменить это действие нельзя.",
            Highlight = $"«{project.Name}»",
            Details = details,
            ConfirmText = "Удалить сборку",
            IsDestructive = true
        };
    }

    /// <summary>Confirmation for permanently deleting installed mods or removing mod separators.</summary>
    public static ConfirmDialogOptions DeleteModItems(IReadOnlyList<ModEntry> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        if (items.Count == 0)
        {
            throw new ArgumentException("At least one mod item is required.", nameof(items));
        }

        int modCount = items.Count(item => item.IsMod);
        int separatorCount = items.Count(item => item.IsSeparator);
        string highlight = items.Count == 1
            ? $"«{items[0].DisplayName}»"
            : RussianCount(items.Count, "элемент", "элемента", "элементов");

        List<ConfirmDialogDetail> details = new()
        {
            new ConfirmDialogDetail
            {
                Icon = ConfirmDialogDetail.IconFromResource(modCount > 0 ? "Icon.Layers" : "Icon.FileText"),
                Label = items.Count == 1
                    ? items[0].IsSeparator ? "Разделитель" : "Мод"
                    : "Выбрано",
                Value = items.Count == 1 ? items[0].DisplayName : SelectedNamesSummary(items)
            }
        };

        if (items.Count > 1)
        {
            if (modCount > 0)
            {
                details.Add(new ConfirmDialogDetail
                {
                    Icon = ConfirmDialogDetail.IconFromResource("Icon.Layers"),
                    Label = "Моды",
                    Value = modCount.ToString()
                });
            }

            if (separatorCount > 0)
            {
                details.Add(new ConfirmDialogDetail
                {
                    Icon = ConfirmDialogDetail.IconFromResource("Icon.FileText"),
                    Label = "Разделители",
                    Value = separatorCount.ToString()
                });
            }
        }

        return new ConfirmDialogOptions
        {
            Heading = DeleteModItemsHeading(items.Count, modCount, separatorCount),
            Message = DeleteModItemsMessage(items, modCount, separatorCount, highlight),
            Highlight = highlight,
            Details = details,
            ConfirmText = DeleteModItemsConfirmText(items.Count, modCount, separatorCount),
            IsDestructive = true
        };
    }

    /// <summary>Confirmation for permanently deleting download files from disk.</summary>
    public static ConfirmDialogOptions DeleteDownloads(IReadOnlyList<DownloadEntry> downloads)
    {
        ArgumentNullException.ThrowIfNull(downloads);
        if (downloads.Count == 0)
        {
            throw new ArgumentException("At least one download is required.", nameof(downloads));
        }

        string highlight = downloads.Count == 1
            ? $"«{DownloadDisplayName(downloads[0])}»"
            : RussianCount(downloads.Count, "файл", "файла", "файлов");

        List<ConfirmDialogDetail> details = new()
        {
            new ConfirmDialogDetail
            {
                Icon = ConfirmDialogDetail.IconFromResource("Icon.FileText"),
                Label = downloads.Count == 1 ? "Файл" : "Выбрано",
                Value = downloads.Count == 1 ? DownloadDisplayName(downloads[0]) : SelectedNamesSummary(downloads)
            }
        };

        if (downloads.Count == 1 && !string.IsNullOrWhiteSpace(downloads[0].LocalPath))
        {
            details.Add(new ConfirmDialogDetail
            {
                Icon = ConfirmDialogDetail.IconFromResource("Icon.Folder"),
                Label = "Путь",
                Value = downloads[0].LocalPath
            });
        }

        return new ConfirmDialogOptions
        {
            Heading = downloads.Count == 1 ? "Удалить файл загрузки?" : "Удалить выбранные загрузки?",
            Message = downloads.Count == 1
                ? $"{highlight} будет безвозвратно удалён из загрузок. Отменить это действие нельзя."
                : $"Выбранные файлы ({highlight}) будут безвозвратно удалены из загрузок. Отменить это действие нельзя.",
            Highlight = highlight,
            Details = details,
            ConfirmText = downloads.Count == 1 ? "Удалить файл" : "Удалить загрузки",
            IsDestructive = true
        };
    }

    private static string DeleteModItemsHeading(int itemCount, int modCount, int separatorCount)
    {
        if (itemCount == 1)
        {
            return modCount == 1 ? "Удалить мод?" : "Удалить разделитель?";
        }

        return modCount > 0 && separatorCount > 0
            ? "Удалить выбранные элементы?"
            : modCount > 0
                ? "Удалить выбранные моды?"
                : "Удалить выбранные разделители?";
    }

    private static string DeleteModItemsMessage(
        IReadOnlyList<ModEntry> items,
        int modCount,
        int separatorCount,
        string highlight)
    {
        if (items.Count == 1)
        {
            return modCount == 1
                ? $"{highlight} и все его файлы будут безвозвратно удалены с диска. Отменить это действие нельзя."
                : $"{highlight} будет удалён из порядка модов. Отменить это действие нельзя.";
        }

        if (modCount > 0 && separatorCount > 0)
        {
            return $"{highlight}: моды будут удалены с диска, а разделители удалены из порядка модов. Отменить это действие нельзя.";
        }

        return modCount > 0
            ? $"{highlight} будут безвозвратно удалены с диска. Отменить это действие нельзя."
            : $"{highlight} будут удалены из порядка модов. Отменить это действие нельзя.";
    }

    private static string DeleteModItemsConfirmText(int itemCount, int modCount, int separatorCount)
    {
        if (itemCount == 1)
        {
            return modCount == 1 ? "Удалить мод" : "Удалить разделитель";
        }

        return modCount > 0 && separatorCount > 0
            ? "Удалить выбранное"
            : modCount > 0
                ? "Удалить моды"
                : "Удалить разделители";
    }

    private static string SelectedNamesSummary(IReadOnlyList<ModEntry> items)
    {
        const int visibleNameLimit = 3;
        string names = string.Join(", ", items.Take(visibleNameLimit).Select(item => item.DisplayName));
        return items.Count <= visibleNameLimit
            ? names
            : $"{names} и ещё {items.Count - visibleNameLimit}";
    }

    private static string SelectedNamesSummary(IReadOnlyList<DownloadEntry> downloads)
    {
        const int visibleNameLimit = 3;
        string names = string.Join(", ", downloads.Take(visibleNameLimit).Select(DownloadDisplayName));
        return downloads.Count <= visibleNameLimit
            ? names
            : $"{names} и ещё {downloads.Count - visibleNameLimit}";
    }

    private static string DownloadDisplayName(DownloadEntry download)
    {
        return !string.IsNullOrWhiteSpace(download.FileName)
            ? download.FileName
            : download.Name;
    }

    private static string RussianCount(int count, string one, string few, string many)
    {
        int absolute = Math.Abs(count);
        int modulo100 = absolute % 100;
        if (modulo100 is >= 11 and <= 14)
        {
            return $"{count} {many}";
        }

        return (absolute % 10) switch
        {
            1 => $"{count} {one}",
            >= 2 and <= 4 => $"{count} {few}",
            _ => $"{count} {many}"
        };
    }

    public static ConfirmDialogOptions IncludeGeneratedFluxPackAssets(ModProject project)
    {
        List<ConfirmDialogDetail> details = new()
        {
            new ConfirmDialogDetail
            {
                Icon = ConfirmDialogDetail.IconFromResource("Icon.FileText"),
                Label = "FluxPack",
                Value = "Source archives stay as links; generated assets are optional."
            },
            new ConfirmDialogDetail
            {
                Icon = ConfirmDialogDetail.IconFromResource("Icon.Folder"),
                Label = "Сборка",
                Value = project.ProjectDirectory
            }
        };

        return new ConfirmDialogOptions
        {
            Heading = "Включить generated assets?",
            Message = $"Для «{project.Name}» можно добавить манифест generated assets: LODGen, Synthesis, Nemesis, BodySlide, Pandora и похожие результаты. Это не добавит исходные архивы модов, но отметит эти файлы как разрешённые пользователем.",
            Highlight = $"«{project.Name}»",
            Details = details,
            ConfirmText = "Включить",
            CancelText = "Только рецепт"
        };
    }
}
