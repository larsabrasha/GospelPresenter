using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Web.Components;
using GospelPresenter.Shared.Services;
using GospelPresenter.Web.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Prometheus;
using GospelPresenter.Web.Configuration;
using GospelPresenter.Web.Services;
using Microsoft.AspNetCore.Components.Authorization;
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

    builder.Services.AddAuthentication(options =>
        {
            options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
        })
        .AddCookie(options =>
        {
            options.ExpireTimeSpan = TimeSpan.FromMinutes(sessionTimeoutMinutes);
            options.SlidingExpiration = false;
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Lax;
        })
        .AddOpenIdConnect(options =>
        {
            options.Authority = builder.Configuration["OpenIdConnect:Authority"];
            options.ClientId = builder.Configuration["OpenIdConnect:ClientId"];
            options.ClientSecret = builder.Configuration["OpenIdConnect:ClientSecret"];
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
                var subject = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                if (string.IsNullOrEmpty(subject))
                {
                    context.Fail("No subject claim found");
                    return;
                }

                var userService = context.HttpContext.RequestServices.GetRequiredService<IUserService>();
                string? inviteToken = null;
                context.Properties?.Items.TryGetValue("invite_token", out inviteToken);

                User? user;
                if (!string.IsNullOrEmpty(inviteToken))
                {
                    var invite = await userService.GetInviteByTokenAsync(inviteToken);
                    if (invite == null)
                    {
                        context.Fail("Invalid invite");
                        return;
                    }
                    await userService.LinkLoginAsync(invite.UserId, "oidc", subject);
                    await userService.MarkInviteUsedAsync(invite.Id);
                    user = invite.User;
                }
                else
                {
                    user = await userService.GetByLoginAsync("oidc", subject);
                    if (user == null)
                    {
                        context.Fail("User not found");
                        return;
                    }
                }

                if (string.IsNullOrEmpty(user.Email))
                {
                    var email = context.Principal?.FindFirstValue(ClaimTypes.Email);
                    if (!string.IsNullOrEmpty(email))
                        await userService.UpdateEmailIfEmptyAsync(user.Id, email);
                }

                if (string.IsNullOrEmpty(user.ProfileImage))
                {
                    var pictureUrl = context.Principal?.FindFirstValue("picture");
                    if (!string.IsNullOrEmpty(pictureUrl))
                    {
                        var httpClientFactory = context.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>();
                        var profileImageService = context.HttpContext.RequestServices.GetRequiredService<IProfileImageService>();
                        var imageBytes = await DownloadImage(httpClientFactory, pictureUrl);
                        if (imageBytes != null)
                        {
                            var (full, small) = profileImageService.Resize(imageBytes, "image/jpeg");
                            await userService.UpdateProfileImageAsync(user.Id, full, small);
                        }
                    }
                }

                var identity = context.Principal?.Identity as ClaimsIdentity;
                identity?.AddClaim(new Claim("user_id", user.Id));
                identity?.AddClaim(new Claim("organization_id", user.OrganizationId));
                identity?.AddClaim(new Claim("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()));
                identity?.AddClaim(new Claim(ClaimTypes.Role, user.Role.ToString()));
            };

            options.Events.OnRemoteFailure = context =>
            {
                context.Response.Redirect("/authentication-error");
                context.HandleResponse();
                return Task.CompletedTask;
            };
        })
        .AddGoogle(options =>
        {
            options.ClientId = builder.Configuration["Google:ClientId"] ?? "";
            options.ClientSecret = builder.Configuration["Google:ClientSecret"] ?? "";
            options.CallbackPath = "/signin-google";

            options.Scope.Add("profile");
            options.Scope.Add("email");

            options.ClaimActions.MapJsonKey(System.Security.Claims.ClaimTypes.Name, "name");
            options.ClaimActions.MapJsonKey(System.Security.Claims.ClaimTypes.Email, "email");
            options.ClaimActions.MapJsonKey("picture", "picture");

            options.Events.OnTicketReceived = async context =>
            {
                var subject = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                if (string.IsNullOrEmpty(subject))
                {
                    context.Response.Redirect("/authentication-error");
                    context.HandleResponse();
                    return;
                }

                var userService = context.HttpContext.RequestServices.GetRequiredService<IUserService>();
                string? inviteToken = null;
                context.Properties?.Items.TryGetValue("invite_token", out inviteToken);

                User? user;
                if (!string.IsNullOrEmpty(inviteToken))
                {
                    var invite = await userService.GetInviteByTokenAsync(inviteToken);
                    if (invite == null)
                    {
                        context.Response.Redirect("/authentication-error");
                        context.HandleResponse();
                        return;
                    }
                    await userService.LinkLoginAsync(invite.UserId, "google", subject);
                    await userService.MarkInviteUsedAsync(invite.Id);
                    user = invite.User;
                }
                else
                {
                    user = await userService.GetByLoginAsync("google", subject);
                    if (user == null)
                    {
                        context.Response.Redirect("/authentication-error");
                        context.HandleResponse();
                        return;
                    }
                }

                if (string.IsNullOrEmpty(user.Email))
                {
                    var email = context.Principal?.FindFirstValue(ClaimTypes.Email);
                    if (!string.IsNullOrEmpty(email))
                        await userService.UpdateEmailIfEmptyAsync(user.Id, email);
                }

                if (string.IsNullOrEmpty(user.ProfileImage))
                {
                    var pictureUrl = context.Principal?.FindFirstValue("picture");
                    if (!string.IsNullOrEmpty(pictureUrl))
                    {
                        var httpClientFactory = context.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>();
                        var profileImageService = context.HttpContext.RequestServices.GetRequiredService<IProfileImageService>();
                        var imageBytes = await DownloadImage(httpClientFactory, pictureUrl);
                        if (imageBytes != null)
                        {
                            var (full, small) = profileImageService.Resize(imageBytes, "image/jpeg");
                            await userService.UpdateProfileImageAsync(user.Id, full, small);
                        }
                    }
                }

                var identity = context.Principal?.Identity as ClaimsIdentity;
                identity?.AddClaim(new Claim("user_id", user.Id));
                identity?.AddClaim(new Claim("organization_id", user.OrganizationId));
                identity?.AddClaim(new Claim("auth_time", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()));
                identity?.AddClaim(new Claim(ClaimTypes.Role, user.Role.ToString()));
            };

            options.Events.OnRemoteFailure = context =>
            {
                context.Response.Redirect("/authentication-error");
                context.HandleResponse();
                return Task.CompletedTask;
            };
        });

    builder.Services.AddHttpClient();
    builder.Services.AddAuthorization();

    builder.Services.AddCascadingAuthenticationState();
    builder.Services.AddScoped<AuthenticationStateProvider, RevalidatingAuthStateProvider>();

// Add services to the container.
    builder.Services.AddRazorComponents(options => options.DetailedErrors = builder.Environment.IsDevelopment())
        .AddInteractiveServerComponents()
        .AddHubOptions(options => options.MaximumReceiveMessageSize = 512 * 1024);

    builder.Services.AddSharedGospelPresenterServices(builder.Configuration);
    builder.Services.AddSingleton<IStatusBarService, StatusBarService>();

    builder.Services.AddHealthChecks()
        .ForwardToPrometheus();

    builder.Services.UseHttpClientMetrics();

    string[] supportedCultures = ["sv"];
    builder.Services.Configure<RequestLocalizationOptions>(options =>
    {
        options.SetDefaultCulture(supportedCultures[0])
            .AddSupportedCultures(supportedCultures)
            .AddSupportedUICultures(supportedCultures);
    });
    builder.Services.AddLocalization();

    var connectionString = builder.Configuration.GetConnectionString("postgresdb");
    if (!string.IsNullOrEmpty(connectionString))
    {
        builder.Services.AddDbContextFactory<PresentationContext>(opt =>
            opt.UseNpgsql(connectionString));
        builder.Services.AddScoped<IPresentationService, PresentationService>();
        builder.Services.AddScoped<IUserService, UserService>();
    }
    else
    {
        Log.Warning("No database connection string found — using mock services");
        builder.Services.AddSingleton<IPresentationService, MockPresentationService>();
        builder.Services.AddSingleton<IUserService, MockUserService>();
    }

#if !DEBUG
builder.Services.AddMetricServer(options =>
{
    options.Port = 1337; // Use metrics on another port, to not expose it outside the cluster
});
#endif

    var app = builder.Build();

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

    // Seed admin user if no users exist
    if (!string.IsNullOrEmpty(connectionString))
    {
        using var scope = app.Services.CreateScope();
        var dbContextFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<PresentationContext>>();
        await using var db = await dbContextFactory.CreateDbContextAsync();
        if (!await db.Users.AnyAsync())
        {
            var org = new Organization { Name = "Default" };
            var admin = new User { Name = "Admin", Role = UserRole.Admin, Organization = org };
            var invite = new Invite { User = admin };
            db.Organizations.Add(org);
            db.Users.Add(admin);
            db.Invites.Add(invite);
            await db.SaveChangesAsync();
            Log.Warning("No users found — created admin user with invite link: /invite/{Token}", invite.Token);
        }
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
    app.UseAuthorization();

    app.UseAntiforgery();

    app.UseRequestLocalization(supportedCultures);

    app.MapStaticAssets();
    app.MapRazorComponents<App>()
        .AddInteractiveServerRenderMode()
        .AddAdditionalAssemblies(typeof(GospelPresenter.Shared._Imports).Assembly);

    app.MapGet("/signin", (string? returnUrl, string? provider) =>
    {
        var scheme = provider == "google"
            ? GoogleDefaults.AuthenticationScheme
            : OpenIdConnectDefaults.AuthenticationScheme;
        return Results.Challenge(new AuthenticationProperties { RedirectUri = returnUrl ?? "/" }, [scheme]);
    }).AllowAnonymous();

    app.MapGet("/invite/{token}/signin", async (string token, string provider, IUserService userService) =>
    {
        var invite = await userService.GetInviteByTokenAsync(token);
        if (invite == null)
            return Results.Redirect("/authentication-error");

        var scheme = provider == "google"
            ? GoogleDefaults.AuthenticationScheme
            : OpenIdConnectDefaults.AuthenticationScheme;

        var properties = new AuthenticationProperties { RedirectUri = "/" };
        properties.Items["invite_token"] = token;

        return Results.Challenge(properties, [scheme]);
    }).AllowAnonymous();

    app.MapPost("/signout", async (HttpContext context) =>
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        context.Response.Redirect("/");
    }).RequireAuthorization();

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
