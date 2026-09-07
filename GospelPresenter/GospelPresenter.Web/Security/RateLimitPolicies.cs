namespace GospelPresenter.Web.Security;

public static class RateLimitPolicies
{
    /// <summary>A few concurrent uploads per user, queued past that; see Program.cs.</summary>
    public const string Uploads = "uploads";
}
