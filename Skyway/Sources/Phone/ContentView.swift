import SwiftUI
import MapKit

struct ContentView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var navigationService: NavigationService
    @EnvironmentObject private var locationService: LocationService
    @EnvironmentObject private var alertEngine: AlertEngine

    @State private var isFollowing = true
    @State private var showingSearch = false
    @State private var showingReport = false
    @State private var showingWeather = false

    var body: some View {
        ZStack {
            MapScreen(isFollowing: $isFollowing)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottomBar
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            if let alert = alertEngine.activeAlert {
                VStack {
                    AlertBanner(alert: alert) {
                        alertEngine.dismissActive()
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: alertEngine.activeAlert?.id)
        .animation(.easeInOut(duration: 0.25), value: navigationService.state)
        .sheet(isPresented: $showingSearch) { SearchSheet() }
        .sheet(isPresented: $showingReport) { ReportSheet() }
        .sheet(isPresented: $showingWeather) { WeatherSheet() }
        .task {
            locationService.requestAuthorization()
        }
    }

    // MARK: - Top

    @ViewBuilder
    private var topBar: some View {
        switch navigationService.state {
        case .navigating:
            ManeuverCard()
        default:
            HStack(spacing: 12) {
                WeatherPill { showingWeather = true }
                Spacer()
                if environment.isCarPlayConnected {
                    Label("In car", systemImage: "car.fill")
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.regularMaterial, in: Capsule())
                }
            }
            .padding(.top, 8)
        }
    }

    // MARK: - Bottom

    @ViewBuilder
    private var bottomBar: some View {
        switch navigationService.state {
        case .idle, .arrived:
            VStack(spacing: 12) {
                mapControls
                SearchButton { showingSearch = true }
            }

        case .planning:
            HStack(spacing: 10) {
                ProgressView()
                Text("Finding routes…")
                    .font(.subheadline)
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

        case .previewing:
            RoutePreviewCard()

        case .navigating:
            VStack(spacing: 12) {
                mapControls
                GuidanceCard(onReport: { showingReport = true })
            }
        }
    }

    private var mapControls: some View {
        HStack {
            Spacer()
            VStack(spacing: 10) {
                if navigationService.state == .navigating {
                    MapControlButton(systemImage: "cloud.sun.fill") { showingWeather = true }
                }
                MapControlButton(
                    systemImage: isFollowing ? "location.fill" : "location"
                ) {
                    isFollowing = true
                }
            }
        }
    }
}

// MARK: - Small shared pieces

struct MapControlButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: Circle())
        }
        .buttonStyle(.plain)
    }
}

struct SearchButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                Text("Where to?")
                    .fontWeight(.medium)
                Spacer()
            }
            .font(.body)
            .foregroundStyle(.primary)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct WeatherPill: View {
    @EnvironmentObject private var environment: AppEnvironment
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let weather = environment.currentWeather {
                    Image(systemName: weather.condition.symbolName)
                        .symbolRenderingMode(.multicolor)
                    Text("\(Int(weather.temperature.rounded()))°")
                        .fontWeight(.semibold)
                } else {
                    Image(systemName: "cloud")
                    Text("—")
                }
            }
            .font(.subheadline)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct AlertBanner: View {
    let alert: DriverAlert
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: alert.symbolName)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(Color(uiColor: alert.severity.overlayColor), in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(alert.title)
                    .font(.headline)
                if let subtitle = alert.subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button(action: onDismiss) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
    }
}
