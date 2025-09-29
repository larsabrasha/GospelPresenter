window.viewportMonitor = {
    init: function (DotNetRef) {
        function onResize() {
            DotNetRef.invokeMethodAsync("HandleViewportSizeChangeAsync", {
                Width: window.innerWidth,
                Height: window.innerHeight
            });
        }

        window.addEventListener('resize', onResize);

        DotNetRef.invokeMethodAsync("InitViewportMonitorAsync", {
            Width: window.innerWidth,
            Height: window.innerHeight
        });
    }
}
