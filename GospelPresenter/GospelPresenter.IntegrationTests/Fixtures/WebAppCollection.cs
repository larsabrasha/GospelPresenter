namespace GospelPresenter.IntegrationTests.Fixtures;

/// <summary>
/// Serialises the test classes that boot the application. Each of them creates its own
/// <see cref="WebAppFixture"/>, and resolving the web application's entry point from two classes at once
/// fails with "The entry point exited without ever building an IHost".
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public class WebAppCollection
{
    public const string Name = "WebApp";
}
