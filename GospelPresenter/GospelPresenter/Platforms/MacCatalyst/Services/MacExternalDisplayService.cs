using System.Runtime.InteropServices;
using CoreGraphics;
using Foundation;
using ObjCRuntime;

namespace GospelPresenter.Services;

/// <summary>
/// The projector on a Mac. Catalyst has no UIKit surface for placing a window on a chosen screen,
/// but every Catalyst app is an AppKit app underneath: this reaches through the ObjC runtime to
/// NSScreen and NSWindow — enumerate the screens, find the native window carrying the live
/// window's (unique) title, park it on the external screen and toggle native fullscreen.
/// </summary>
public class MacExternalDisplayService : IExternalDisplayService
{
    private const nuint FullScreenStyleMask = 1 << 14;

    public bool HasExternalScreen => ScreenCount() > 1;

    public bool TryMoveWindowToExternalScreen(string windowTitle)
    {
        var screens = GetScreensArray();
        if (screens is null || (nint)screens.Count < 2)
            return false;

        // The last screen in the list is virtually always the newly attached projector; the menu
        // fallback lets the user re-run this if the guess was wrong on an exotic setup.
        var externalScreen = screens.ValueAt((nuint)((nint)screens.Count - 1));
        var window = FindWindowByTitle(windowTitle);
        if (window == IntPtr.Zero)
            return false;

        var frame = GetRect(externalScreen, Selector.GetHandle("frame"));
        SendVoidRectByte(window, Selector.GetHandle("setFrame:display:"), frame, 1);

        var styleMask = SendNuint(window, Selector.GetHandle("styleMask"));
        if ((styleMask & FullScreenStyleMask) == 0)
            SendVoidPtr(window, Selector.GetHandle("toggleFullScreen:"), IntPtr.Zero);

        return true;
    }

    private static nint ScreenCount()
    {
        var screens = GetScreensArray();
        return screens is null ? 0 : (nint)screens.Count;
    }

    private static NSArray? GetScreensArray()
    {
        var nsScreenClass = objc_getClass("NSScreen");
        if (nsScreenClass == IntPtr.Zero)
            return null;
        var handle = SendPtr(nsScreenClass, Selector.GetHandle("screens"));
        return handle == IntPtr.Zero ? null : Runtime.GetNSObject<NSArray>(handle);
    }

    private static IntPtr FindWindowByTitle(string title)
    {
        var nsAppClass = objc_getClass("NSApplication");
        if (nsAppClass == IntPtr.Zero)
            return IntPtr.Zero;
        var app = SendPtr(nsAppClass, Selector.GetHandle("sharedApplication"));
        var windowsHandle = SendPtr(app, Selector.GetHandle("windows"));
        var windows = Runtime.GetNSObject<NSArray>(windowsHandle);
        if (windows is null)
            return IntPtr.Zero;

        for (nuint i = 0; i < windows.Count; i++)
        {
            var window = windows.ValueAt(i);
            var titleHandle = SendPtr(window, Selector.GetHandle("title"));
            var windowTitle = titleHandle == IntPtr.Zero ? null : Runtime.GetNSObject<NSString>(titleHandle)?.ToString();
            if (windowTitle == title)
                return window;
        }

        return IntPtr.Zero;
    }

    private static CGRect GetRect(IntPtr receiver, IntPtr selector)
    {
        // Large struct returns go through objc_msgSend_stret on x64; arm64 has no stret variant.
        if (RuntimeInformation.ProcessArchitecture == Architecture.Arm64)
            return SendRect(receiver, selector);
        SendRectStret(out var rect, receiver, selector);
        return rect;
    }

    [DllImport("/usr/lib/libobjc.dylib", CharSet = CharSet.Ansi)]
    private static extern IntPtr objc_getClass(string name);

    [DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    private static extern IntPtr SendPtr(IntPtr receiver, IntPtr selector);

    [DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    private static extern nuint SendNuint(IntPtr receiver, IntPtr selector);

    [DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    private static extern void SendVoidPtr(IntPtr receiver, IntPtr selector, IntPtr arg);

    [DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    private static extern void SendVoidRectByte(IntPtr receiver, IntPtr selector, CGRect rect, byte display);

    [DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend")]
    private static extern CGRect SendRect(IntPtr receiver, IntPtr selector);

    [DllImport("/usr/lib/libobjc.dylib", EntryPoint = "objc_msgSend_stret")]
    private static extern void SendRectStret(out CGRect ret, IntPtr receiver, IntPtr selector);
}
