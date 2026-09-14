import CarPlay
import UIKit

/// Entry point for the car screen.
///
/// Named in Info.plist under `CPTemplateApplicationSceneSessionRoleApplication`.
/// The phone scene keeps running independently — this delegate only owns what
/// the car sees.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

    private var carPlayController: CarPlayController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        MainActor.assumeIsolated {
            let mapViewController = CarPlayMapViewController()
            window.rootViewController = mapViewController

            carPlayController = CarPlayController(
                interfaceController: interfaceController,
                mapViewController: mapViewController
            )
            carPlayController?.start()
            AppEnvironment.shared.isCarPlayConnected = true
        }
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        MainActor.assumeIsolated {
            carPlayController?.stop()
            carPlayController = nil
            AppEnvironment.shared.isCarPlayConnected = false
        }
    }
}
