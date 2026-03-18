using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public interface IImageService
{
    Image? GetImageById(string id);
}

public class ImageService : IImageService
{
    private readonly Dictionary<string, Image> allImages = new()
    {
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47i", new Image(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47i",
                ["media/swish.jpg"])
        }
    };

    public Image? GetImageById(string id)
    {
        return allImages.GetValueOrDefault(id);
    }
}
