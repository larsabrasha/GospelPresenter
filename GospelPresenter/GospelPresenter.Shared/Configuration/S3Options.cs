namespace GospelPresenter.Shared.Configuration;

public class S3Options
{
    public string Endpoint { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string BucketName { get; set; } = "gospelpresenter";
    public string Region { get; set; } = "garage";
    public string AdminEndpoint { get; set; } = "";
    public string AdminToken { get; set; } = "";
}
