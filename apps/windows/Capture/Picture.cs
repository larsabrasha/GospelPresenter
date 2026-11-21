// A window's picture through Windows.Graphics.Capture: the compositor's frame of it, in the window's own pixels (no
// scaling: a window at 150 % is pictured at 150 %), without the mouse pointer.
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using WinRT;

namespace GospelPresenter.Capture;

/// <summary>A window's picture as PNG, and its size in pixels.</summary>
sealed record Picture(byte[] Png, int Width, int Height)
{
    /// <summary>The window once something is drawn in it: frames until one has more than one colour (WinUI's window is
    /// one colour until its first frame), or the last one when none has in <paramref name="limit"/>, then blank.</summary>
    public static async Task<(Picture Picture, bool Blank)> WhenDrawn(IntPtr window, TimeSpan limit)
    {
        var until = DateTime.UtcNow + limit;
        while (true)
        {
            var bitmap = await Frame(window);
            var blank = OneColour(bitmap);
            if (!blank || DateTime.UtcNow >= until) return (await Encode(bitmap), blank);
            await Task.Delay(500);
        }
    }

    static async Task<SoftwareBitmap> Frame(IntPtr window)
    {
        var item = ItemFor(window);
        var device = Direct3D.Device();
        using var pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 1, item.Size);
        using var session = pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled = false;
        var arrived = new TaskCompletionSource<Direct3D11CaptureFrame>();
        pool.FrameArrived += (p, _) =>
        {
            if (p.TryGetNextFrame() is { } frame && !arrived.TrySetResult(frame)) frame.Dispose();
        };
        session.StartCapture();
        if (await Task.WhenAny(arrived.Task, Task.Delay(5000)) != arrived.Task)
            throw new TimeoutException("no frame of the window in 5 s");
        using var frame = arrived.Task.Result;
        return await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Premultiplied);
    }

    /// <summary>Every pixel of the window's inside (its title bar left out) the same colour.</summary>
    static bool OneColour(SoftwareBitmap bitmap)
    {
        var bytes = new byte[4 * bitmap.PixelWidth * bitmap.PixelHeight];
        bitmap.CopyToBuffer(bytes.AsBuffer());
        var stride = 4 * bitmap.PixelWidth;
        var first = BitConverter.ToInt32(bytes, stride * (bitmap.PixelHeight / 2) + 4 * (bitmap.PixelWidth / 2));
        for (var y = bitmap.PixelHeight / 10; y < bitmap.PixelHeight - 8; y += 2)
            for (var x = 8; x < bitmap.PixelWidth - 8; x += 2)
                if (BitConverter.ToInt32(bytes, y * stride + 4 * x) != first) return false;
        return true;
    }

    static async Task<Picture> Encode(SoftwareBitmap bitmap)
    {
        using var stream = new InMemoryRandomAccessStream();
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetSoftwareBitmap(bitmap);
        await encoder.FlushAsync();
        var png = new byte[stream.Size];
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        await reader.LoadAsync((uint)stream.Size);
        reader.ReadBytes(png);
        return new Picture(png, bitmap.PixelWidth, bitmap.PixelHeight);
    }

    /// <summary>IGraphicsCaptureItem's interface id, which CreateForWindow is asked for.</summary>
    static readonly Guid ItemIid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");

    static GraphicsCaptureItem ItemFor(IntPtr window)
    {
        var interop = ActivationFactory.Get("Windows.Graphics.Capture.GraphicsCaptureItem").AsInterface<IGraphicsCaptureItemInterop>();
        var iid = ItemIid;
        return MarshalInterface<GraphicsCaptureItem>.FromAbi(interop.CreateForWindow(window, ref iid));
    }

    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow(IntPtr window, ref Guid iid);
        IntPtr CreateForMonitor(IntPtr monitor, ref Guid iid);
    }
}

/// <summary>A Direct3D 11 device for the frames, as WinRT takes it.</summary>
static class Direct3D
{
    const int Hardware = 1;
    const uint BgraSupport = 0x20, SdkVersion = 7;
    static readonly Guid DxgiDevice = new("54ec77fa-1377-44e6-8c32-88fd5f44c84c");

    [DllImport("d3d11.dll")]
    static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr levels,
        uint levelCount, uint sdk, out IntPtr device, IntPtr level, IntPtr context);

    [DllImport("d3d11.dll")]
    static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr device);

    public static IDirect3DDevice Device()
    {
        Marshal.ThrowExceptionForHR(D3D11CreateDevice(IntPtr.Zero, Hardware, IntPtr.Zero, BgraSupport, IntPtr.Zero, 0,
            SdkVersion, out var d3d, IntPtr.Zero, IntPtr.Zero));
        var iid = DxgiDevice;
        Marshal.ThrowExceptionForHR(Marshal.QueryInterface(d3d, ref iid, out var dxgi));
        Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out var device));
        Marshal.Release(dxgi);
        Marshal.Release(d3d);
        return MarshalInterface<IDirect3DDevice>.FromAbi(device);
    }
}
