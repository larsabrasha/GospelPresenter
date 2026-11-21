// A passkey added or a Google account linked from the app, as the desktop app does it (the web's auth/passkey.ts with
// `appSignIn`): the server begins the ceremony for an app (`/api/auth/passkey/begin` mode register, or
// `/api/auth/google/begin` link) and answers an address; the ceremony runs there in the system's own sign-in window
// (ASWebAuthenticationSession), which closes when the page sends it to the app's callback scheme; the page watches for
// the new login to appear, as the web's Logins.tsx waits for the system browser.
import AuthenticationServices
import SwiftUI

@MainActor
final class BrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    /// The scheme the server sends the browser back to (packages/core's CALLBACK_SCHEMES).
    static let scheme = "gospelpresenter"
    private var session: ASWebAuthenticationSession?

    /// This device's name, as a new login names it.
    static var deviceName: String {
        #if os(macOS)
        Host.current().localizedName ?? "Mac"
        #else
        UIDevice.current.name
        #endif
    }

    /// The ceremony at `url`, until the page hands back to the app or the person closes the window.
    func open(_ url: URL) async {
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.scheme) { _, _ in done.resume() }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() { done.resume() }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if os(macOS)
            NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
            #else
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
            #endif
        }
    }
}
