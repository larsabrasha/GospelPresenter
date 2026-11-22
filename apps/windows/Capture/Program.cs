// A picture of a window as the screen shows it: gp-capture EXE|--hwnd N OUT.png [--keep]
//   EXE         start it, picture its main window once drawn, then stop it (unless --keep)
//   --hwnd N    picture that window, already running
// Windows.Graphics.Capture reads the compositor's frame of the window alone, behind other windows too, where a copy of
// the screen has whatever is on top.
// The compositor draws nothing while the display is off (the PC left alone a few minutes), and a picture taken then is
// empty, so the display is woken first and kept on. Exit code 0 with the picture, 2 when the window stayed blank.
using System.Diagnostics;
using System.Runtime.InteropServices;
using GospelPresenter.Capture;

if (args.Length < 2)
{
    Console.Error.WriteLine("gp-capture EXE|--hwnd N OUT.png [--keep]");
    return 1;
}
Display.Wake();
Process? started = null;
IntPtr window;
string output;
if (args[0] == "--hwnd")
{
    window = new IntPtr(long.Parse(args[1]));
    output = args[2];
}
else
{
    output = args[1];
    started = Process.Start(new ProcessStartInfo(args[0]) { UseShellExecute = true })!;
    window = MainWindow(started);
    if (window == IntPtr.Zero)
    {
        Console.Error.WriteLine($"{args[0]} has no window ({(started.HasExited ? $"exited {started.ExitCode}" : "none in 30 s")})");
        return 1;
    }
}
try
{
    var (picture, blank) = await Picture.WhenDrawn(window, TimeSpan.FromSeconds(15));
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
    await File.WriteAllBytesAsync(output, picture.Png);
    Console.WriteLine($"{output} {picture.Width}x{picture.Height}{(blank ? " BLANK" : "")}");
    return blank ? 2 : 0;
}
finally
{
    if (started is { HasExited: false } && !args.Contains("--keep")) started.Kill();
}

static IntPtr MainWindow(Process process)
{
    for (var i = 0; i < 150 && process.MainWindowHandle == IntPtr.Zero && !process.HasExited; i++)
    {
        Thread.Sleep(200);
        process.Refresh();
    }
    return process.HasExited ? IntPtr.Zero : process.MainWindowHandle;
}

namespace GospelPresenter.Capture
{
    /// <summary>The display on, so the compositor draws what is pictured.</summary>
    static class Display
    {
        const uint EsContinuous = 0x80000000, EsSystemRequired = 0x1, EsDisplayRequired = 0x2;
        const uint InputMouse = 0, MouseMove = 0x1;

        [StructLayout(LayoutKind.Sequential)]
        struct MouseInput { public int Dx, Dy; public uint Data, Flags, Time; public IntPtr Extra; }

        [StructLayout(LayoutKind.Sequential)]
        struct Input { public uint Type; public MouseInput Mouse; }

        [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
        [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);

        /// <summary>Keeps the display on while this runs, and wakes it if it is off: a move of the mouse by none, which
        /// Windows takes as the user's input.</summary>
        public static void Wake()
        {
            SetThreadExecutionState(EsContinuous | EsSystemRequired | EsDisplayRequired);
            var move = new Input { Type = InputMouse, Mouse = new MouseInput { Flags = MouseMove } };
            SendInput(1, [move], Marshal.SizeOf<Input>());
        }
    }
}
