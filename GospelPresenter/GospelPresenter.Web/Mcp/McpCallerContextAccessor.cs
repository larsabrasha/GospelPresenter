using GospelPresenter.Shared.Services;
using Microsoft.AspNetCore.Http;

namespace GospelPresenter.Web.Mcp;

public class McpCallerContextAccessor(IHttpContextAccessor httpContextAccessor)
{
    private const string CallerKey = "Mcp.Caller";
    private const string OrgIdKey = "Mcp.OrganizationId";
    private const string UserIdKey = "Mcp.UserId";

    public CallerContext? Caller
    {
        get => httpContextAccessor.HttpContext?.Items[CallerKey] as CallerContext;
        set => SetItem(CallerKey, value);
    }

    public string? OrganizationId
    {
        get => httpContextAccessor.HttpContext?.Items[OrgIdKey] as string;
        set => SetItem(OrgIdKey, value);
    }

    public string? UserId
    {
        get => httpContextAccessor.HttpContext?.Items[UserIdKey] as string;
        set => SetItem(UserIdKey, value);
    }

    private void SetItem(string key, object? value)
    {
        if (httpContextAccessor.HttpContext is not null)
            httpContextAccessor.HttpContext.Items[key] = value;
    }
}
