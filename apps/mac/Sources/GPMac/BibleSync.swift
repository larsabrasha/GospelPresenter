// The Bible texts this device keeps, fetched and dropped as the core says (Shell's `SyncClient.syncBibleTexts`,
// the web's syncBibles): after every change and pull, as the media files are.
import Foundation

extension AppState {
    /// Once at a time, again if asked meanwhile.
    func syncBibles() {
        guard case let .synced(client) = store else { return }
        if bibleRunning { bibleAgain = true; return }
        bibleRunning = true
        Task { @MainActor in
            repeat {
                bibleAgain = false
                await client.syncBibleTexts()
            } while bibleAgain
            bibleRunning = false
        }
    }
}
