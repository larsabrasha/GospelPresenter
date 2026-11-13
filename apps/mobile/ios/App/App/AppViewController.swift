import Capacitor

/// The app's one screen: Capacitor's web view, with the plugins that live in this app rather than in a package.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebAuthPlugin())
        bridge?.registerPluginInstance(OutputScreensPlugin())
    }
}
