using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public static class ValidationHelper
{
    public static void RequireMaxLength(string? value, int maxLength, string fieldName)
    {
        if (value is not null && value.Length > maxLength)
            throw new InvalidOperationException(
                $"The field '{fieldName}' exceeds the maximum length of {maxLength} characters.");
    }

    public static void RequireRange(int? value, int min, int max, string fieldName)
    {
        if (value.HasValue && (value.Value < min || value.Value > max))
            throw new InvalidOperationException(
                $"The field '{fieldName}' must be between {min} and {max}.");
    }

    public static async Task RequireMaxCountAsync<T>(
        IQueryable<T> query, int maxCount, string entityName, CancellationToken cancellationToken = default)
    {
        var count = await query.CountAsync(cancellationToken);
        if (count >= maxCount)
            throw new InvalidOperationException(
                $"The maximum number of {entityName} ({maxCount}) has been reached.");
    }

    public static string? Truncate(string? value, int maxLength)
        => value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
