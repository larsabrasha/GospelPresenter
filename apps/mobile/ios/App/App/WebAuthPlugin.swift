import AuthenticationServices
import Capacitor

/// The phone app's sign-in (spec 01 device sign-in; apps/web/src/auth/appSignIn.ts): the server's sign-in page in
/// ASWebAuthenticationSession, iOS's sheet for it, which shares Safari's passkeys and cookies. The sheet catches the
/// callback scheme itself and hands back the callback URL, with the token in its fragment; no other app can take it.
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)]

    /// The one sign-in that may be open; a new one closes it.
    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), let url = URL(string: address), ["https", "http"].contains(url.scheme ?? ""),
              let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("A sign-in needs an http(s) address and a callback scheme", "invalid")
            return
        }
        DispatchQueue.main.async {
            self.session?.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.session = nil
                if let callback {
                    call.resolve(["url": callback.absoluteString])
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    call.reject("The sign-in was closed", "cancelled")
                } else {
                    call.reject(error?.localizedDescription ?? "The sign-in failed", "failed")
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("The sign-in could not start", "failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
