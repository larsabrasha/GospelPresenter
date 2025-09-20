namespace GospelPresenter.Shared.HttpClients;

public class DelayHandler(TimeSpan delay) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(delay, cancellationToken); // Add artificial delay
        return await base.SendAsync(request, cancellationToken);
    }
}
