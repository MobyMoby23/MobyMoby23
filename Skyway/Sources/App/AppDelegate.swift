import UIKit

/// Kept deliberately thin.
///
/// Scene routing is declared in Info.plist rather than here: the
/// `CPTemplateApplicationSceneSessionRoleApplication` entry names
/// `CarPlaySceneDelegate`, and SwiftUI's own `WindowGroup` continues to own
/// the phone window scene. Overriding `configurationForConnecting` would take
/// that window scene away from SwiftUI, which is a well-worn way to end up
/// with a black screen on the phone while CarPlay works fine.
final class AppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Touching the shared environment here means the location and incident
        // services are already running by the time either scene connects —
        // including the case where the car connects first and the phone app was
        // never opened.
        MainActor.assumeIsolated {
            _ = AppEnvironment.shared
        }
        return true
    }
}
