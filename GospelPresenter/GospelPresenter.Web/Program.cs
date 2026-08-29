using GospelPresenter.Shared;
using GospelPresenter.Shared.Authorization;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Web.Components;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using GospelPresenter.Web;
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
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
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
    const string CookieOrDeviceTokenScheme = "CookieOrDeviceToken";

    var connectionString = builder.Configuration.GetConnectionString("postgresdb");
    var isMockMode = string.IsNullOrEmpty(connectionString);

    // Mock mode wires up anonymous, credential-free sign-in as a seeded Admin (see /mock-signin
    // and the mock-user-id middleware below). It must never activate in Production: a misconfigured
    // or missing connection string would otherwise silently turn the app into an open door. Fail fast.
    if (isMockMode && builder.Environment.IsProduction())
        throw new InvalidOperationException(
            "No database connection string ('postgresdb') is configured. Mock authentication is disabled in Production — configure the database connection.");

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

        // The default scheme routes each request by shape: a Bearer gpdt_ header authenticates as a
        // device (the MAUI app), everything else as a cookie session. Every claims-reading endpoint
        // then serves both kinds of caller unchanged.
        var authBuilder = builder.Services.AddAuthentication(options =>
            {
                options.DefaultScheme = CookieOrDeviceTokenScheme;
            })
            .AddPolicyScheme(CookieOrDeviceTokenScheme, CookieOrDeviceTokenScheme, options =>
            {
                options.ForwardDefaultSelector = SelectCookieOrDeviceTokenScheme;
            })
            .AddScheme<AuthenticationSchemeOptions, GospelPresenter.Web.Auth.DeviceTokenAuthenticationHandler>(
                GospelPresenter.Web.Auth.DeviceTokenAuthenticationHandler.SchemeName, null)
            .AddCookie(options =>
            {
                options.ExpireTimeSpan = TimeSpan.FromMinutes(sessionTimeoutMinutes);
                options.SlidingExpiration = false;
                options.Cookie.HttpOnly = true;
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.LoginPath = "/login";

                // Reject the cookie of a user whose account no longer exists. The circuit-level
                // check in RevalidatingAuthStateProvider only runs once a minute and starts over
                // on every reload, so without this a deleted user keeps a usable window until the
                // cookie expires (SessionTimeoutMinutes, four hours by default).
                options.Events.OnValidatePrincipal = RejectDeletedUser;
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
                options.SignedOutRedirectUri = "/";
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
                    Log.Warning(context.Failure, "Remote authentication failure");
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

                options.Events.OnRedirectToAuthorizationEndpoint = context =>
                {
                    var uri = context.RedirectUri + (context.RedirectUri.Contains('?') ? "&" : "?") + "prompt=select_account";
                    context.Response.Redirect(uri);
                    return Task.CompletedTask;
                };

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
                    Log.Warning(context.Failure, "Remote authentication failure");
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
        builder.Services.AddAuthentication(CookieOrDeviceTokenScheme)
            .AddPolicyScheme(CookieOrDeviceTokenScheme, CookieOrDeviceTokenScheme, options =>
            {
                options.ForwardDefaultSelector = SelectCookieOrDeviceTokenScheme;
            })
            .AddScheme<AuthenticationSchemeOptions, GospelPresenter.Web.Auth.DeviceTokenAuthenticationHandler>(
                GospelPresenter.Web.Auth.DeviceTokenAuthenticationHandler.SchemeName, null)
            .AddCookie(options =>
            {
                options.LoginPath = "/mock-login";
                // Same session rule as the real providers: a deleted account stops working here too.
                options.Events.OnValidatePrincipal = RejectDeletedUser;
            });
        builder.Services.AddScoped<AuthenticationStateProvider, MockAuthenticationStateProvider>();
        builder.Services.AddSingleton<IAuthProviderService, MockAuthProviderService>();
    }

    builder.Services.AddHttpClient();
    builder.Services.AddPermissionAuthorization();

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

    builder.Services.AddMemoryCache();
    builder.Services.AddScoped<IPresentationService, PresentationService>();
    builder.Services.AddSingleton<ISongService, SongService>();
    builder.Services.AddSingleton<IBibleService, BibleService>();
    builder.Services.AddScoped<IUserService, UserService>();
    builder.Services.AddScoped<IOnboardingService, OnboardingService>();
    builder.Services.AddScoped<IOrganizationImageService, OrganizationImageService>();
    builder.Services.AddScoped<IOrganizationAudioService, OrganizationAudioService>();
    builder.Services.AddScoped<IOrganizationSettingService, OrganizationSettingService>();
    builder.Services.AddSingleton<ICcliReportService, CcliReportService>();
    builder.Services.AddSingleton<IPdfRenderService, PdfRenderService>();
    builder.Services.AddScoped<IPresentationSlidesService, PresentationSlidesService>();
    builder.Services.AddScoped<GospelPresenter.Shared.Sync.ISyncService, GospelPresenter.Shared.Sync.SyncService>();
    builder.Services.AddScoped<ICalendarFeedService, CalendarFeedService>();

    var gotenbergEndpoint = builder.Configuration.GetValue<string>("Gotenberg:Endpoint");
    if (!string.IsNullOrWhiteSpace(gotenbergEndpoint))
    {
        builder.Services.AddHttpClient(GotenbergPowerPointConverter.HttpClientName, client =>
        {
            client.BaseAddress = new Uri(gotenbergEndpoint);
            client.Timeout = TimeSpan.FromSeconds(120);
        });
    }
    else
    {
        // Register an empty client so IPowerPointConverter.IsConfigured returns false.
        builder.Services.AddHttpClient(GotenbergPowerPointConverter.HttpClientName);
    }
    builder.Services.AddSingleton<IPowerPointConverter, GotenbergPowerPointConverter>();
    builder.Services.AddHostedService<GospelPresenter.Web.Services.CcliReportBackgroundService>();
    builder.Services.AddHostedService<GospelPresenter.Web.Services.SyncMaintenanceBackgroundService>();

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
        await MockDatabaseInitializer.InitializeAsync(
            dbFactory, app.Services.GetRequiredService<ILogger<Program>>());
    }

    {
        var bibleService = app.Services.GetRequiredService<IBibleService>();
        await bibleService.LoadBiblesAsync();
    }

    {
        var songService = app.Services.GetRequiredService<ISongService>();
        await songService.LoadSongsAsync();
    }

    app.MapDefaultEndpoints();

    app.UseSerilogRequestLogging();

    // Production runs behind the Cloudflare tunnel, which terminates TLS: every request arrives as
    // http and the forced scheme makes generated absolute URLs (OAuth redirects, the cookie login
    // redirect) correctly say https. Locally there is no proxy and Kestrel really serves http —
    // forcing https here would send the sign-in redirect to an https URL nobody listens on.
    if (!app.Environment.IsDevelopment())
    {
        app.Use((context, next) =>
        {
            context.Request.Scheme = "https";
            return next(context);
        });
    }

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
        // Mock sign-in middleware: if "mock-user-id" cookie is set (e.g. by the screenshot tool),
        // auto-sign in as that user. Otherwise redirect to /mock-login for manual org selection.
        app.Use(async (context, next) =>
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                var mockUserId = context.Request.Cookies["mock-user-id"];
                if (mockUserId is not null)
                {
                    var subjectId = mockUserId == "mock-user-en" ? "mock-en" : "mock-sv";
                    var userService = context.RequestServices.GetRequiredService<IUserService>();
                    var user = await userService.GetByLoginAsync("mock", subjectId);
                    if (user is not null)
                    {
                        var principal = MockAuthenticationStateProvider.CreatePrincipal(user);
                        context.User = principal;
                        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
                    }
                }
                else
                {
                    var path = context.Request.Path.Value ?? "";
                    var isPublicPath = path.StartsWith("/mock-login", StringComparison.OrdinalIgnoreCase)
                                     || path.StartsWith("/mock-signin", StringComparison.OrdinalIgnoreCase)
                                     || path.StartsWith("/_", StringComparison.OrdinalIgnoreCase)
                                     || path.StartsWith("/health", StringComparison.OrdinalIgnoreCase)
                                     || path.StartsWith("/api/calendar/", StringComparison.OrdinalIgnoreCase)
                                     || path.StartsWith("/watch/", StringComparison.OrdinalIgnoreCase)
                                     || path.StartsWith("/api/watch/", StringComparison.OrdinalIgnoreCase)
                                     // Product graphics with no organisation behind them; the projector
                                     // and the public output fetch them without signing in.
                                     || path.StartsWith("/api/theme-images/", StringComparison.OrdinalIgnoreCase)
                                     || path.Equals("/live", StringComparison.OrdinalIgnoreCase)
                                     || path.Equals("/display", StringComparison.OrdinalIgnoreCase);
                    // API clients (a device token in the Authorization header) can never use the
                    // mock login page; let them fall through to a proper 401 instead of a redirect.
                    var isApiClient = context.Request.Headers.ContainsKey("Authorization");
                    if (!isPublicPath && !isApiClient)
                    {
                        context.Response.Redirect("/mock-login");
                        return;
                    }
                }
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

    // Restores a stored language for a browser that has no culture cookie yet. A browser that has
    // one never reaches the lookup, so only users with nothing stored do — and for them it would
    // otherwise repeat on every single request, including every static asset, since
    // UseAuthentication runs before the static-file endpoints. Remembering the miss collapses that
    // to one query.
    //
    // Picking a language is unaffected: /culture writes the cookie in the same response as it
    // stores the setting, so that browser short-circuits from then on. The one case a remembered
    // miss delays is a second browser signed in as the same user, which keeps its old culture
    // until the entry expires.
    var noStoredLanguageCacheDuration = TimeSpan.FromSeconds(
        app.Services.GetRequiredService<IOptions<Settings>>().Value.PreferredLanguageCacheSeconds);

    app.Use(async (context, next) =>
    {
        // Browser sessions only: an API client (the device app's Bearer requests) never stores
        // cookies, so the set-cookie-and-redirect dance would repeat on every call — and the
        // redirect makes HttpClient drop its Authorization header, which turns a valid device
        // token into a login-page HTML response. API responses are not localized via cookies;
        // the sync paths read the user's stored language directly where they need it.
        if (!context.Request.Path.StartsWithSegments("/api")
            && context.User.Identity?.IsAuthenticated == true
            && !context.Request.Cookies.ContainsKey(CookieRequestCultureProvider.DefaultCookieName))
        {
            var userId = context.User.FindFirst("user_id")?.Value;
            if (userId is not null)
            {
                var cache = context.RequestServices.GetRequiredService<IMemoryCache>();
                var cacheKey = $"no-preferred-language:{userId}";

                if (!cache.TryGetValue(cacheKey, out _))
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

                    if (noStoredLanguageCacheDuration > TimeSpan.Zero)
                        cache.Set(cacheKey, true, noStoredLanguageCacheDuration);
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

    if (isMockMode)
    {
        app.MapGet("/mock-signin/{userId}", async (string userId, IUserService userService, HttpContext context) =>
        {
            if (context.User.Identity?.IsAuthenticated == true)
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

            var subjectId = userId == "mock-user-en" ? "mock-en" : "mock-sv";
            var user = await userService.GetByLoginAsync("mock", subjectId);
            if (user is null) return Results.NotFound();

            var principal = MockAuthenticationStateProvider.CreatePrincipal(user);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);

            context.Response.Cookies.Append("mock-user-id", userId,
                new CookieOptions { Expires = DateTimeOffset.UtcNow.AddYears(1), IsEssential = true });

            return Results.Redirect("/");
        }).AllowAnonymous();
    }

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
        var provider = context.User.FindFirstValue("login_provider") ?? "";

        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        if (provider == "oidc")
        {
            await context.SignOutAsync(OpenIdConnectDefaults.AuthenticationScheme);
        }
        else
        {
            context.Response.Redirect("/");
        }
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

    app.MapGet("/api/images/slides/{slidesId}/{page}", async (
        string slidesId, int page,
        HttpContext context,
        IObjectStorageService storage,
        IPresentationSlidesService slidesService) =>
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return Results.Unauthorized();

        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        var orgId = context.User.FindFirst("organization_id")?.Value;
        if (orgId is null) return Results.Forbid();

        var caller = new CallerContext(userId, role, orgId);

        try
        {
            await slidesService.GetByIdAsync(slidesId, orgId, caller);
        }
        catch (UnauthorizedAccessException)
        {
            return Results.Forbid();
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound();
        }

        var s3Key = ImageUrlHelper.SlidesPageKey(orgId, slidesId, page);
        var result = await storage.GetAsync(s3Key);
        if (result is null) return Results.NotFound();

        var (stream, contentType) = result.Value;
        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return Results.File(stream, contentType);
    }).RequireAuthorization();

    // Built-in theme art. Product graphics rather than congregation data, so it is anonymous and cached
    // hard — the projector, the operator's browser and every visitor's phone all fetch the same file. The
    // URL carries a content hash, which is what allows immutable caching of a theme we update in place.
    app.MapGet("/api/theme-images/{slug}/{fileName}", async (
        string slug, string fileName,
        HttpContext context,
        IObjectStorageService storage,
        IThemeAssetService themeAssets) =>
    {
        var assetPath = ThemeAssetService.AssetPathFromRequest(slug, fileName);
        if (assetPath is null) return Results.NotFound();

        var variant = fileName.Contains("-thumb-", StringComparison.Ordinal) ? "thumb" : "full";
        var hash = themeAssets.ComputeContentHash(assetPath);
        if (hash is null) return Results.NotFound();

        // Object storage is the delivery path; the copy embedded in the application is the source of
        // truth. Development, the tests and the screenshot tool have no storage configured at all, and
        // the unconfigured implementation throws rather than returning nothing.
        try
        {
            var stored = await storage.GetAsync(ImageUrlHelper.ThemeAssetKey(assetPath, variant, hash));
            if (stored is not null)
            {
                context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
                return Results.File(stored.Value.Stream, stored.Value.ContentType);
            }
        }
        catch (NotSupportedException)
        {
            // No object storage in this environment.
        }

        var bytes = themeAssets.ReadAsset(assetPath);
        if (bytes is null) return Results.NotFound();

        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return Results.File(bytes, "image/webp");
    }).AllowAnonymous();

    app.MapUploadEndpoints();

    // Unauthenticated slides endpoint for the live view — served while the session's presentation is active.
    app.MapGet("/api/live-images/{sessionId}/slides/{slidesId}/{page}", async (
        string sessionId, string slidesId, int page,
        HttpContext context,
        SharedAppState sharedAppState,
        IObjectStorageService storage) =>
    {
        if (!sharedAppState.IsPresentationActive(sessionId))
            return Results.NotFound();

        var orgId = sharedAppState.GetSessionOrganizationId(sessionId);
        if (orgId is null) return Results.NotFound();

        var s3Key = ImageUrlHelper.SlidesPageKey(orgId, slidesId, page);
        var result = await storage.GetAsync(s3Key);
        if (result is null) return Results.NotFound();

        var (stream, contentType) = result.Value;
        context.Response.Headers.CacheControl = "public, max-age=3600";
        return Results.File(stream, contentType);
    }).AllowAnonymous();

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

    // Authenticated audio endpoint
    app.MapGet("/api/audio/org-audio/{id}", async (
        string id,
        HttpContext context,
        IObjectStorageService storage,
        IOrganizationAudioService audioService) =>
    {
        var userId = context.User.FindFirst("user_id")?.Value;
        if (userId is null) return Results.Unauthorized();

        var role = Enum.TryParse<UserRole>(context.User.FindFirst(ClaimTypes.Role)?.Value, out var r) ? r : UserRole.User;
        var orgId = context.User.FindFirst("organization_id")?.Value;
        if (orgId is null) return Results.Forbid();

        var caller = new CallerContext(userId, role, orgId);

        try
        {
            var audio = await audioService.GetAudioByIdAsync(id, orgId, caller);
            if (audio is null) return Results.NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Results.Forbid();
        }

        var result = await storage.GetAsync(ImageUrlHelper.OrgAudioKey(orgId, id));
        if (result is null) return Results.NotFound();

        var (stream, contentType) = result.Value;
        // Buffer into MemoryStream so the response supports range requests.
        // iOS Safari requires range request support (206 Partial Content) to play audio.
        // The S3 response stream is not seekable, so we buffer it first.
        var ms = new MemoryStream();
        await stream.CopyToAsync(ms);
        ms.Seek(0, SeekOrigin.Begin);
        context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return Results.File(ms, contentType, enableRangeProcessing: true);
    }).RequireAuthorization();

    app.MapCalendarEndpoints();
    app.MapPublicOutputEndpoints();
    app.MapDeviceTokenEndpoints();
    app.MapSyncEndpoints();

    // Resolve the broadcaster eagerly: it subscribes to live-state events in its constructor,
    // and a lazily created singleton would miss every change until the first visitor connected.
    app.Services.GetRequiredService<PublicOutputBroadcaster>();

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
            var keyHash = McpApiKey.HashKey(apiKey);
            var db = context.RequestServices.GetRequiredService<PresentationContext>();
            var key = await db.McpApiKeys.FirstOrDefaultAsync(k => k.KeyHash == keyHash);

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

static string SelectCookieOrDeviceTokenScheme(HttpContext context) =>
    context.Request.Headers.Authorization.FirstOrDefault()
        ?.StartsWith($"Bearer {DeviceToken.Prefix}", StringComparison.Ordinal) == true
        ? GospelPresenter.Web.Auth.DeviceTokenAuthenticationHandler.SchemeName
        : CookieAuthenticationDefaults.AuthenticationScheme;

static async Task RejectDeletedUser(CookieValidatePrincipalContext context)
{
    var userId = context.Principal?.FindFirstValue("user_id");
    if (string.IsNullOrEmpty(userId))
        return;

    var services = context.HttpContext.RequestServices;
    var cache = services.GetRequiredService<IMemoryCache>();
    var cacheKey = $"user-exists:{userId}";
    var cacheDuration = TimeSpan.FromSeconds(
        services.GetRequiredService<IOptions<Settings>>().Value.SessionRevalidationCacheSeconds);

    // This event fires for every request carrying the cookie — including each static asset, since
    // UseAuthentication runs before the static-file endpoints. Caching the "still exists" answer
    // keeps one page load to a single query instead of one per file. Only the positive answer is
    // cached: a rejected user is signed out on the spot, so there is nothing to remember.
    var cachingEnabled = cacheDuration > TimeSpan.Zero;
    if (cachingEnabled && cache.TryGetValue(cacheKey, out _))
        return;

    var userService = services.GetRequiredService<IUserService>();
    try
    {
        if (await userService.UserExistsAsync(userId, context.HttpContext.RequestAborted))
        {
            if (cachingEnabled)
                cache.Set(cacheKey, true, cacheDuration);
            return;
        }
    }
    catch (OperationCanceledException)
    {
        // The client went away mid-request; there is no session left to protect.
        return;
    }
    catch (Exception ex)
    {
        // Keep the session if the database is unreachable — signing everyone out during a database
        // blip would interrupt a service in progress, and the app cannot show content without it.
        Log.Warning(ex, "Could not verify that user {UserId} still exists; keeping the session", userId);
        return;
    }

    Log.Information("Rejecting session for user {UserId}: the account no longer exists", userId);
    context.RejectPrincipal();
    await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
}

static async Task HandleAuthenticatedUser(
    HttpContext httpContext,
    ClaimsPrincipal? principal,
    AuthenticationProperties? properties,
    string loginProvider,
    Action<string> onFailure)
{
    // Both callers turn the failure into a bare redirect to /authentication-error, so this log is
    // the only place the actual reason survives.
    void Reject(string reason)
    {
        Log.Warning("Rejecting {Provider} sign-in: {Reason}", loginProvider, reason);
        onFailure(reason);
    }

    var subject = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
    if (string.IsNullOrEmpty(subject))
    {
        Reject("the ticket carried no subject claim");
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
            Reject("the invite token is unknown, already used, or expired");
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
            Reject($"no user is linked to {loginProvider} subject {subject} — the account must be "
                   + "linked once through an invite link before plain sign-in works");
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
    identity?.AddClaim(new Claim("login_provider", loginProvider));
    identity?.AddClaim(new Claim(ClaimTypes.Role, user.Role.ToString()));

    Log.Information("Signed in user {UserId} via {Provider}", user.Id, loginProvider);
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

// Exposed so the integration tests can boot the real application through WebApplicationFactory.
public partial class Program;
