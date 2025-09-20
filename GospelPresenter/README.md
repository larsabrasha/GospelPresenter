# GospelPresenter

## Requirements

* .Net 9 SDK (9.0.304)
    <https://dotnet.microsoft.com/en-us/download/dotnet/9.0>
* MAUI workload

    ```shell
    dotnet workload install maui
    ```

    If it already is installed check if it needs an upgrade:
    
    ```shell
    dotnet workload restore
    ```

## Setup

## Run or Debug these targets from Rider or Visual Studio

* For Windows:
    - GospelPresenter: Windows Machine

* For local dev on Mac for Web:
    - GospelPresenter.Web: Hot reload\
    Starts GospelPresenter.Web: Hot reload together with two scripts: Hot Reload Helper and Tailwindcss watch, to make hot reload working as desired\
    Three tabs are expected with the three separate executables\
    If any trouble occurs, try to run the scripts in separate to see any potential problems.
      
    Install "fswatch": 
    
    ```
    brew install fswatch
    ```

### Troubleshooting

For Rider:
* Verify that the same .NET version is used in terminal `which dotnet` (eg. when restoring workloads) and in Rider -> Settings -> Build, Execution, Deployment -> Toolset and Build.

## Build

Read more:
<https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/publish/?view=aspnetcore-9.0>

