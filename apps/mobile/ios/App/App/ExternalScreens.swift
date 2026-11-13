import AVFoundation
import Capacitor
import UIKit
import WebKit

/// The screens iOS gives the app beside its own (Lars, 2026-11-07, docs/phone-app.md "AirPlay"): an Apple TV through
/// AirPlay, or a display on a cable. Each arrives as a scene of its own, which the app takes instead of mirroring its
/// screen: black until the output is switched on for it, then the output page (`/output`) in a web view of its own,
/// on the same storage as the app's, so it reads the app's database and the live channel as an output window does
/// in a browser. That page is then the primary output: picture and sound from one element, and iOS sends the sound to
/// the Apple TV with the picture.
final class ExternalScreens {
    static let shared = ExternalScreens()

    /// The screens connected, by their scene's id, in the order they came.
    private var scenes: [(id: String, scene: UIWindowScene, window: UIWindow)] = []
    /// The outputs open, by screen.
    private var outputs: [String: WKWebView] = [:]
    /// The app's own web view, whose storage and pages the outputs share.
    weak var appWebView: WKWebView?
    /// Told when a screen comes or goes, and when an output opens or closes.
    var onChange: (() -> Void)?

    /// What a screen shows while its output is off: black, as the black screen is.
    private func black() -> UIViewController {
        let view = UIViewController()
        view.view.backgroundColor = .black
        return view
    }

    func connect(_ scene: UIWindowScene) {
        let window = UIWindow(windowScene: scene)
        window.rootViewController = black()
        window.isHidden = false
        scenes.append((scene.session.persistentIdentifier, scene, window))
        onChange?()
    }

    func disconnect(_ scene: UIScene) {
        let id = scene.session.persistentIdentifier
        outputs.removeValue(forKey: id)
        scenes.removeAll { $0.id == id }
        onChange?()
    }

    /// The screens, named by the AirPlay device when the sound goes to one ("Vardagsrum"), else nameless.
    func displays() -> [[String: String]] {
        let airPlay = AVAudioSession.sharedInstance().currentRoute.outputs.first { $0.portType == .airPlay }?.portName ?? ""
        return scenes.map { ["id": $0.id, "name": airPlay] }
    }

    func openIds() -> [String] {
        scenes.map(\.id).filter { outputs[$0] != nil }
    }

    /// Shows `url` on the screen `id`; false when there is no such screen or no app page to share storage with.
    func open(_ id: String, url: URL) -> Bool {
        guard let entry = scenes.first(where: { $0.id == id }), let app = appWebView else { return false }
        if outputs[id] != nil { return true }
        let base = app.configuration
        let config = WKWebViewConfiguration()
        config.processPool = base.processPool
        config.websiteDataStore = base.websiteDataStore
        // The app's own pages come from its scheme (capacitor://localhost), served by Capacitor's handler.
        if let scheme = url.scheme, let handler = base.urlSchemeHandler(forURLScheme: scheme) {
            config.setURLSchemeHandler(handler, forURLScheme: scheme)
        }
        // Nobody can tap a TV: its video and sound start untouched.
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: entry.window.bounds, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // The web view is the window's own view, so it takes the screen's size as the screen has it, a change of mode too.
        let host = UIViewController()
        host.view = web
        entry.window.rootViewController = host
        web.load(URLRequest(url: url))
        outputs[id] = web
        onChange?()
        return true
    }

    /// Closes the output on `id`, or every output with none; the screen stays black.
    func close(_ id: String?) {
        for key in outputs.keys where id == nil || key == id {
            outputs.removeValue(forKey: key)
            scenes.first { $0.id == key }?.window.rootViewController = black()
        }
        onChange?()
    }
}

/// A screen beside the app's own: handed to ExternalScreens (AppDelegate picks this for that role).
class ExternalSceneDelegate: UIResponder, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        ExternalScreens.shared.connect(windowScene)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        ExternalScreens.shared.disconnect(scene)
    }
}

/// The web app's side of the screens (apps/web/src/live/outputWindow.ts `phoneHost`): which there are, and an output
/// on one switched on and off, as the desktop app's output windows are.
@objc(OutputScreensPlugin)
public class OutputScreensPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OutputScreensPlugin"
    public let jsName = "OutputScreens"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "displays", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "opened", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        let screens = ExternalScreens.shared
        screens.appWebView = bridge?.webView
        screens.onChange = { [weak self] in
            self?.notifyListeners("changed", data: ["displays": screens.displays(), "open": screens.openIds()])
        }
    }

    @objc func displays(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["displays": ExternalScreens.shared.displays()]) }
    }

    @objc func opened(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["open": ExternalScreens.shared.openIds()]) }
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let address = call.getString("url"), let url = URL(string: address) else {
            call.reject("An output needs a screen and a page", "invalid")
            return
        }
        DispatchQueue.main.async { call.resolve(["opened": ExternalScreens.shared.open(id, url: url)]) }
    }

    @objc func close(_ call: CAPPluginCall) {
        let id = call.getString("id")
        DispatchQueue.main.async {
            ExternalScreens.shared.close(id)
            call.resolve()
        }
    }
}

