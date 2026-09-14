import SwiftUI

@main
struct SkywayApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var environment = AppEnvironment.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(environment)
                .environmentObject(environment.locationService)
                .environmentObject(environment.navigationService)
                .environmentObject(environment.incidentService)
                .environmentObject(environment.alertEngine)
                .environmentObject(environment.searchService)
                .environmentObject(environment.voiceService)
        }
    }
}
