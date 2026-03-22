namespace GospelPresenter.Web.Configuration;

public class AuthenticationOptions
{
    public GoogleOptions Google { get; set; } = new();
    public OpenIdConnectOptions OpenIdConnect { get; set; } = new();
}

public class GoogleOptions
{
    public bool Enabled { get; set; }
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
}

public class OpenIdConnectOptions
{
    public bool Enabled { get; set; }
    public string Authority { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string DisplayName { get; set; } = "OpenID Connect";
}
