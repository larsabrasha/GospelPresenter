using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Web.Components;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Web.Configuration;
using GospelPresenter.Web.Mcp;
using GospelPresenter.Web.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Localization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Prometheus;
using System.Security.Claims;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

Log.Information("Starting up");

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.AddServiceDefaults();

    builder.Host.UseSerilog((hostBuilderContext, loggerConfiguration) => loggerConfiguration
        .ReadFrom.Configuration(hostBuilderContext.Configuration)
    );

    builder.Services.Configure<Settings>(builder.Configuration.GetSection("Settings"));

    if (builder.Environment.IsProduction())
    {
        var dataProtectionDirectory = builder.Configuration.GetSection("Settings:DataProtectionKeysDirectory").Value!;
        builder.Services.AddDataProtection()
            .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionDirectory));
    }

    var sessionTimeoutMinutes = builder.Configuration.GetValue("Settings:SessionTimeoutMinutes", 240);
    var connectionString = builder.Configuration.GetConnectionString("postgresdb");
    var isMockMode = string.IsNullOrEmpty(connectionString);

    if (!isMockMode)
    {
        var authOptions = builder.Configuration.GetSection("Authentication").Get<GospelPresenter.Web.Configuration.AuthenticationOptions>()
                          ?? new GospelPresenter.Web.Configuration.AuthenticationOptions();

        var googleConfigured = authOptions.Google.Enabled && !string.IsNullOrEmpty(authOptions.Google.ClientId);
        var oidcConfigured = authOptions.OpenIdConnect.Enabled && !string.IsNullOrEmpty(authOptions.OpenIdConnect.ClientId);
        if (!googleConfigured && !oidcConfigured)
            throw new InvalidOperationException("At least one authentication provider must be enabled and configured (Google or OpenID Connect).");

        builder.Services.Configure<GospelPresenter.Web.Configuration.AuthenticationOptions>(builder.Configuration.GetSection("Authentication"));
        builder.Services.AddSingleton<IAuthProviderService, AuthProviderService>();

        var authBuilder = builder.Services.AddAuthentication(options =>
            {
                options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            })
            .AddCookie(options =>
            {
                options.ExpireTimeSpan = TimeSpan.FromMinutes(sessionTimeoutMinutes);
                options.SlidingExpiration = false;
                options.Cookie.HttpOnly = true;
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.LoginPath = "/login";
            });

        if (oidcConfigured)
        {
            authBuilder.AddOpenIdConnect(options =>
            {
                options.Authority = authOptions.OpenIdConnect.Authority;
                options.ClientId = authOptions.OpenIdConnect.ClientId;
                options.ClientSecret = authOptions.OpenIdConnect.ClientSecret;
                options.ResponseType = "code";
                options.SaveTokens = true;
                options.GetClaimsFromUserInfoEndpoint = true;
                options.CallbackPath = "/signin-oidc";
                options.SignedOutCallbackPath = "/signout-callback-oidc";
                options.Scope.Add("openid");
                options.Scope.Add("profile");
                options.Scope.Add("email");

                options.Events.OnRedirectToIdentityProvider = context =>
                {
                    context.ProtocolMessage.Prompt = "login";
                    return Task.CompletedTask;
                };

                options.Events.OnTokenValidated = async context =>
                {
                    await HandleAuthenticatedUser(context.HttpContext, context.Principal, context.Properties,
                        "oidc",
                        onFailure: msg => context.Fail(msg));
                };

                options.Events.OnRemoteFailure = context =>
                {
                    context.Response.Redirect("/authentication-error");
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
            });
        }

        if (googleConfigured)
        {
            authBuilder.AddGoogle(options =>
            {
                options.ClientId = authOptions.Google.ClientId;
                options.ClientSecret = authOptions.Google.ClientSecret;
                options.CallbackPath = "/signin-google";

                options.Scope.Add("profile");
                options.Scope.Add("email");

                options.ClaimActions.MapJsonKey(System.Security.Claims.ClaimTypes.Name, "name");
                options.ClaimActions.MapJsonKey(System.Security.Claims.ClaimTypes.Email, "email");
                options.ClaimActions.MapJsonKey("picture", "picture");

                options.Events.OnTicketReceived = async context =>
                {
                    await HandleAuthenticatedUser(context.HttpContext, context.Principal, context.Properties,
                        "google",
                        onFailure: _ =>
                        {
                            context.Response.Redirect("/authentication-error");
                            context.HandleResponse();
                        });
                };

                options.Events.OnRemoteFailure = context =>
                {
                    context.Response.Redirect("/authentication-error");
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
            });
        }

        builder.Services.AddScoped<AuthenticationStateProvider, RevalidatingAuthStateProvider>();
    }
    else
    {
        Log.Warning("No authentication provider configured — using mock authentication");
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie();
        builder.Services.AddScoped<AuthenticationStateProvider, MockAuthenticationStateProvider>();
        builder.Services.AddSingleton<IAuthProviderService, MockAuthProviderService>();
    }

    builder.Services.AddHttpClient();
    builder.Services.AddAuthorization();

    builder.Services.AddCascadingAuthenticationState();

// Add services to the container.
    builder.Services.AddRazorComponents(options => options.DetailedErrors = builder.Environment.IsDevelopment())
        .AddInteractiveServerComponents()
        .AddHubOptions(options => options.MaximumReceiveMessageSize = 512 * 1024);

    builder.Services.AddSharedGospelPresenterServices(builder.Configuration);
    builder.Services.AddSingleton<IStatusBarService, StatusBarService>();
    builder.Services.AddSingleton<SetupStatusService>();

    builder.Services.AddHttpContextAccessor();
    builder.Services.AddTransient<McpCallerContextAccessor>();
    builder.Services
        .AddMcpServer(mcpOptions =>
        {
            mcpOptions.ServerInfo = new() { Name = "GospelPresenter", Version = "1.0.0" };
        })
        .WithHttpTransport()
        .WithToolsFromAssembly();

    builder.Services.AddHealthChecks()
        .ForwardToPrometheus();

    builder.Services.UseHttpClientMetrics();

    string[] supportedCultures = ["en", "sv"];
    builder.Services.Configure<RequestLocalizationOptions>(options =>
    {
        options.SetDefaultCulture("en")
            .AddSupportedCultures(supportedCultures)
            .AddSupportedUICultures(supportedCultures);
        options.RequestCultureProviders.Insert(0, new CookieRequestCultureProvider());
    });

    if (!isMockMode)
    {
        builder.Services.AddDbContextFactory<PresentationContext>(opt =>
            opt.UseNpgsql(connectionString));
    }
    else
    {
        Log.Warning("No database connection string found — using SQLite mock database");
        builder.Services.AddDbContextFactory<PresentationContext>(opt =>
            opt.UseSqlite("Data Source=gospelpresenter-mock.db"));
    }

    builder.Services.AddScoped<IPresentationService, PresentationService>();
    builder.Services.AddSingleton<ISongService, SongService>();
    builder.Services.AddScoped<IUserService, UserService>();
    builder.Services.AddScoped<IOrganizationImageService, OrganizationImageService>();

#if !DEBUG
builder.Services.AddMetricServer(options =>
{
    options.Port = 1337; // Use metrics on another port, to not expose it outside the cluster
});
#endif

    var app = builder.Build();

    if (isMockMode)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var dbFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<PresentationContext>>();
        await using var db = await dbFactory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();
        await MockDataSeeder.SeedAsync(db);
    }

    var biblesPath = app.Configuration.GetSection("Settings:BiblesPath").Value;
    if (!string.IsNullOrEmpty(biblesPath))
    {
        var bibleService = app.Services.GetRequiredService<IBibleService>();
        bibleService.LoadBibles(biblesPath);
    }

    {
        var songService = app.Services.GetRequiredService<ISongService>();
        await songService.LoadSongsAsync();
    }

    app.MapDefaultEndpoints();

    app.UseSerilogRequestLogging();

    app.Use((context, next) =>
    {
        context.Request.Scheme = "https";
        return next(context);
    });

    app.UseForwardedHeaders();

// Configure the HTTP request pipeline.
    if (!app.Environment.IsDevelopment())
    {
        app.UseExceptionHandler("/Error", createScopeForErrors: true);
        // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
        app.UseHsts();
    }

    app.UseHttpsRedirection();

    app.UseAuthentication();

    if (isMockMode)
    {
        // Auto-sign in the mock user via cookie so the HTTP pipeline
        // (middleware, endpoints with RequireAuthorization) also sees
        // an authenticated user — not just Blazor components.
        app.Use(async (context, next) =>
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                var authStateProvider = context.RequestServices.GetRequiredService<AuthenticationStateProvider>();
                var authState = await authStateProvider.GetAuthenticationStateAsync();
                await context.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    authState.User);
            }
            await next(context);
        });
    }

    app.UseAuthorization();

    app.Use(async (context, next) =>
    {
        var path = context.Request.Path.Value ?? "";
        var isSetupPath = path.Equals("/setup", StringComparison.OrdinalIgnoreCase)
                          || path.StartsWith("/invite/", StringComparison.OrdinalIgnoreCase);
        var isStaticOrInternal = path.StartsWith("/_", StringComparison.OrdinalIgnoreCase)
                                 || path.StartsWith("/health", StringComparison.OrdinalIgnoreCase);

        if (!isStaticOrInternal)
        {
            var setupStatus = context.RequestServices.GetRequiredService<SetupStatusService>();
            var userService = context.RequestServices.GetRequiredService<IUserService>();

            if (!await setupStatus.IsSetupCompleteAsync(userService))
            {
                // Clear any stale auth cookie from a previous session to prevent
                // MainLayout's auth logic from causing a redirect loop
                if (context.User.Identity?.IsAuthenticated == true)
                {
                    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                }

                if (!isSetupPath)
                {
                    context.Response.Redirect("/setup");
                    return;
                }
            }
        }

        await next(context);
    });

    app.UseAntiforgery();

    app.Use(async (context, next) =>
    {
        if (context.User.Identity?.IsAuthenticated == true
            && !context.Request.Cookies.ContainsKey(CookieRequestCultureProvider.DefaultCookieName))
        {
            var userId = context.User.FindFirst("user_id")?.Value;
            if (userId is not null)
            {
                var userService = context.RequestServices.GetRequiredService<IUserService>();
                var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
                var orgId = context.User.FindFirst("organization_id")?.Value;
                var caller = new CallerContext(userId, role, orgId);
                var lang = await userService.GetUserSettingAsync(userId, UserSetting.PreferredLanguage, caller);
                if (lang is not null)
                {
                    context.Response.Cookies.Append(
                        CookieRequestCultureProvider.DefaultCookieName,
                        CookieRequestCultureProvider.MakeCookieValue(new RequestCulture(lang)),
                        new CookieOptions { Expires = DateTimeOffset.UtcNow.AddYears(1), IsEssential = true });
                    context.Response.Redirect(context.Request.Path + context.Request.QueryString);
                    return;
                }
            }
        }

        await next(context);
    });

    app.UseRequestLocalization(supportedCultures);

    app.MapStaticAssets();
    app.MapRazorComponents<App>()
        .AddInteractiveServerRenderMode()
        .AddAdditionalAssemblies(typeof(GospelPresenter.Shared._Imports).Assembly);

    app.MapGet("/signin", (string? returnUrl, string? provider, IAuthProviderService authProviders) =>
    {
        var scheme = ResolveScheme(provider, authProviders);
        if (scheme == null)
            return Results.Redirect("/authentication-error");

        return Results.Challenge(new AuthenticationProperties { RedirectUri = returnUrl ?? "/" }, [scheme]);
    }).AllowAnonymous();

    app.MapGet("/invite/{token}/signin", async (string token, string provider, IUserService userService, IAuthProviderService authProviders) =>
    {
        var scheme = ResolveScheme(provider, authProviders);
        if (scheme == null)
            return Results.Redirect("/authentication-error");

        var invite = await userService.GetInviteByTokenAsync(token);
        if (invite == null)
            return Results.Redirect("/authentication-error");

        var properties = new AuthenticationProperties { RedirectUri = "/" };
        properties.Items["invite_token"] = token;

        return Results.Challenge(properties, [scheme]);
    }).AllowAnonymous();

    app.MapPost("/signout", async (HttpContext context) =>
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        context.Response.Redirect("/");
    }).RequireAuthorization();

    app.MapPost("/culture", async (HttpContext context, [FromForm] string culture, [FromForm] string returnUrl, IUserService userService) =>
    {
        context.Response.Cookies.Append(
            CookieRequestCultureProvider.DefaultCookieName,
            CookieRequestCultureProvider.MakeCookieValue(new RequestCulture(culture)),
            new CookieOptions { Expires = DateTimeOffset.UtcNow.AddYears(1), IsEssential = true });

        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is not null)
        {
            var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
            var orgId = context.User.FindFirst("organization_id")?.Value;
            var caller = new CallerContext(userId, role, orgId);
            await userService.SetUserSettingAsync(userId, UserSetting.PreferredLanguage, culture, caller);
        }

        return Results.LocalRedirect(returnUrl ?? "/");
    }).RequireAuthorization();

    // Auth check runs on every request (DB lookup) even though the response is cached
    // with immutable — this is intentional: browsers cache after the first authorized hit,
    // but unauthenticated/unauthorized requests are always rejected.
    app.MapGet("/api/images/{type}/{id}/{variant}", async (
        string type, string id, string variant,
        HttpContext context,
        IObjectStorageService storage,
        IOrganizationImageService imageService,
        IPresentationService presentationService) =>
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return Results.Unauthorized();

        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        var orgId = context.User.FindFirst("organization_id")?.Value;
        var caller = new CallerContext(userId, role, orgId);

        if (orgId is null) return Results.Forbid();

        string s3Key;
        try
        {
            s3Key = type switch
            {
                "org-image" => ImageUrlHelper.OrgImageKey(orgId, id, variant),
                "overlay" => ImageUrlHelper.OverlayImageKey(orgId, id),
                _ => throw new ArgumentException($"Unknown image type: {type}")
            };

            // Verify entity exists and belongs to caller's org
            switch (type)
            {
                case "org-image":
                    var image = await imageService.GetImageByIdAsync(id, orgId, caller);
                    if (image is null) return Results.NotFound();
                    break;
                case "overlay":
                    var overlay = await presentationService.GetOverlayByIdAsync(id, orgId, caller);
                    if (overlay is null) return Results.NotFound();
                    break;
            }
        }
        catch (UnauthorizedAccessException)
        {
            return Results.Forbid();
        }

        var result = await storage.GetAsync(s3Key);
        if (result is null) return Results.NotFound();

        var (stream, contentType) = result.Value;
        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return Results.File(stream, contentType);
    }).RequireAuthorization();

    // Unauthenticated endpoint for the live view — only serves images while the session's presentation is active.
    // Org isolation is enforced by the S3 key structure: org/{orgId}/..., so an image from
    // another org simply won't exist at the path built from this session's org.
    app.MapGet("/api/live-images/{sessionId}/{type}/{id}/{variant}", async (
        string sessionId, string type, string id, string variant,
        HttpContext context,
        SharedAppState sharedAppState,
        IObjectStorageService storage) =>
    {
        if (!sharedAppState.IsPresentationActive(sessionId))
            return Results.NotFound();

        var orgId = sharedAppState.GetSessionOrganizationId(sessionId);
        if (orgId is null) return Results.NotFound();

        var s3Key = type switch
        {
            "org-image" => ImageUrlHelper.OrgImageKey(orgId, id, variant),
            "overlay" => ImageUrlHelper.OverlayImageKey(orgId, id),
            _ => null
        };

        if (s3Key is null) return Results.NotFound();

        var result = await storage.GetAsync(s3Key);
        if (result is null) return Results.NotFound();

        var (stream, contentType) = result.Value;
        context.Response.Headers.CacheControl = "public, max-age=3600";
        return Results.File(stream, contentType);
    }).AllowAnonymous();

    // MCP API key authentication middleware
    app.Use(async (context, next) =>
    {
        if (context.Request.Path.StartsWithSegments("/mcp"))
        {
            var authHeader = context.Request.Headers.Authorization.ToString();
            if (!authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = 401;
                return;
            }

            var apiKey = authHeader["Bearer ".Length..];
            var db = context.RequestServices.GetRequiredService<PresentationContext>();
            var key = await db.McpApiKeys.FirstOrDefaultAsync(k => k.Key == apiKey);

            if (key is null)
            {
                context.Response.StatusCode = 401;
                return;
            }

            var accessor = context.RequestServices.GetRequiredService<McpCallerContextAccessor>();
            accessor.UserId = key.UserId;
            accessor.OrganizationId = key.OrganizationId;
            accessor.Caller = new CallerContext(key.UserId, UserRole.User, key.OrganizationId);
        }

        await next(context);
    });

    app.MapMcp("/mcp");

    app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
    app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();

    // Capture metrics about all received HTTP requests.
    app.UseHttpMetrics();

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Unhandled exception");
}
finally
{
    Log.Information("Shut down complete");
    Log.CloseAndFlush();
}

static string? ResolveScheme(string? provider, IAuthProviderService authProviders)
{
    if (provider == "google" && authProviders.IsEnabled("google"))
        return GoogleDefaults.AuthenticationScheme;

    if (provider == "oidc" && authProviders.IsEnabled("oidc"))
        return OpenIdConnectDefaults.AuthenticationScheme;

    // No explicit provider — use first enabled
    if (string.IsNullOrEmpty(provider))
    {
        var first = authProviders.EnabledProviders.FirstOrDefault();
        return first?.Id switch
        {
            "google" => GoogleDefaults.AuthenticationScheme,
            "oidc" => OpenIdConnectDefaults.AuthenticationScheme,
            _ => null,
        };
    }

    return null;
}

static async Task HandleAuthenticatedUser(
    HttpContext httpContext,
    ClaimsPrincipal? principal,
    AuthenticationProperties? properties,
    string loginProvider,
    Action<string> onFailure)
{
    var subject = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
    if (string.IsNullOrEmpty(subject))
    {
        onFailure("No subject claim found");
        return;
    }

    var userService = httpContext.RequestServices.GetRequiredService<IUserService>();
    string? inviteToken = null;
    properties?.Items.TryGetValue("invite_token", out inviteToken);

    User? user;
    if (!string.IsNullOrEmpty(inviteToken))
    {
        var invite = await userService.GetInviteByTokenAsync(inviteToken);
        if (invite == null)
        {
            onFailure("Invalid invite");
            return;
        }
        await userService.LinkLoginAsync(invite.UserId, loginProvider, subject);
        await userService.MarkInviteUsedAsync(invite.Id);
        user = invite.User;
    }
    else
    {
        user = await userService.GetByLoginAsync(loginProvider, subject);
        if (user == null)
        {
            onFailure("User not found");
            return;
        }
    }

    if (string.IsNullOrEmpty(user.Email))
    {
        var email = principal?.FindFirstValue(ClaimTypes.Email);
        if (!string.IsNullOrEmpty(email))
            await userService.UpdateEmailIfEmptyAsync(user.Id, email);
    }

    if (string.IsNullOrEmpty(user.ProfileImage) && !user.ProfileImageRemoved)
    {
        var pictureUrl = principal?.FindFirstValue("picture");
        if (!string.IsNullOrEmpty(pictureUrl))
        {
            var httpClientFactory = httpContext.RequestServices.GetRequiredService<IHttpClientFactory>();
            var profileImageService = httpContext.RequestServices.GetRequiredService<IProfileImageService>();
            var imageBytes = await DownloadImage(httpClientFactory, pictureUrl);
            if (imageBytes != null)
            {
                var (full, small) = profileImageService.Resize(imageBytes, "image/jpeg");
                await userService.UpdateProfileImageAsync(user.Id, full, small);
            }
        }
    }

    var identity = principal?.Identity as ClaimsIdentity;
    identity?.AddClaim(new Claim("user_id", user.Id));
    if (user.OrganizationId is not null)
        identity?.AddClaim(new Claim("organization_id", user.OrganizationId));
    identity?.AddClaim(new Claim("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()));
    identity?.AddClaim(new Claim(ClaimTypes.Role, user.Role.ToString()));
}

static async Task<byte[]?> DownloadImage(IHttpClientFactory httpClientFactory, string url)
{
    try
    {
        using var http = httpClientFactory.CreateClient();
        using var response = await http.GetAsync(url);
        if (!response.IsSuccessStatusCode) return null;
        return await response.Content.ReadAsByteArrayAsync();
    }
    catch
    {
        return null;
    }
}
