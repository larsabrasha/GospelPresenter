# The Windows app on Windows (docs/windows-app.md): the core as gp_core_ffi.dll, its C# bindings, the texts, then the
# Shell library's tests and the app.
#   apps\windows\build\build.ps1              build the core, the bindings and the texts; test the Shell library
#   apps\windows\build\build.ps1 run          that, then start the app
#   apps\windows\build\build.ps1 -Arch arm64  for ARM64 (default: this machine's)
# Needs Rust (rustup, with Visual Studio's C++ build tools), the .NET 8 SDK or later and Node 22.18 or later (type
# stripping unflagged; tested: 24.11.1); installs uniffi-bindgen-cs on the first run.
param([string]$Command = "build", [string]$Arch = $(if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }), [string]$Out = "")
$ErrorActionPreference = "Stop"
$Root = Resolve-Path "$PSScriptRoot\..\..\.."
$Win = "$Root\apps\windows"
Set-Location $Root

function Run([string]$exe) {
    # A program's stderr (rustup's and cargo's progress) is not a failure: Windows PowerShell 5.1 stops on it under
    # "Stop" when the output is redirected. The exit code says.
    $ErrorActionPreference = "Continue"
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "$exe $args failed ($LASTEXITCODE)" }
}

$target = if ($Arch -eq "arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
Run rustup target add $target
Run cargo rustc --quiet -p gp-core-ffi --lib --release --target $target --crate-type cdylib
New-Item -ItemType Directory -Force "$Win\native\win-$Arch" | Out-Null
Copy-Item "target\$target\release\gp_core_ffi.dll" "$Win\native\win-$Arch\gp_core_ffi.dll"

# The generator for UniFFI 0.32, as build/Dockerfile installs it.
if (-not (Get-Command uniffi-bindgen-cs -ErrorAction SilentlyContinue)) {
    Run cargo install uniffi-bindgen-cs --git https://github.com/NordSecurity/uniffi-bindgen-cs --tag "v0.12.0+v0.32.0"
}
New-Item -ItemType Directory -Force "$Win\Shell\Ffi" | Out-Null
Run uniffi-bindgen-cs --library "target\$target\release\gp_core_ffi.dll" --config crates\gp-core-ffi\uniffi.toml `
    --no-format --out-dir "$Win\Shell\Ffi"
Run node "$Win\texts.mjs"

if (-not (Test-Path "crates\gp-core\parity\.out\fixtures\demo.sqlite")) {
    Write-Warning "demo.sqlite is missing: crates\gp-core\build.sh makes it on a Mac; copy it to crates\gp-core\parity\.out\fixtures\"
}
Run dotnet test "$Win\Shell.Tests"
if ($Command -eq "run") { Run dotnet run --project "$Win\App" -p:Platform=$Arch }
if ($Command -eq "capture") {
    Run dotnet build --nologo -v q "$Win\App" -p:Platform=$Arch
    $exe = "$Win\App\bin\$Arch\Debug\net8.0-windows10.0.19041.0\win-$Arch\GospelPresenter.exe"
    $picture = if ($Out) { $Out } else { "$Win\pictures\start.png" }
    Run dotnet run --project "$Win\Capture" -- $exe $picture
}
