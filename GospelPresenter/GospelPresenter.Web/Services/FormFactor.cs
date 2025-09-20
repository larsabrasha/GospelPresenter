using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web.Services;

public class FormFactor : IFormFactor
{
    public string GetFormFactor() => "Unknown";

    public string GetPlatform() => "Web";
}
