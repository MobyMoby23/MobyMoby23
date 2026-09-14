import SwiftUI
import MapKit

/// The turn card at the top of the screen while navigating.
struct ManeuverCard: View {
    @EnvironmentObject private var navigationService: NavigationService

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: maneuverSymbol)
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 56)

            VStack(alignment: .leading, spacing: 4) {
                Text(distanceText)
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(navigationService.currentStep?.instructions ?? "Continue")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(2)
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(red: 0.07, green: 0.09, blue: 0.13))
        )
        .padding(.top, 8)
    }

    private var distanceText: String {
        MeasurementFormatter.distance.string(
            from: Measurement(
                value: navigationService.progress.distanceToNextManeuver,
                unit: UnitLength.meters
            )
        )
    }

    private var maneuverSymbol: String {
        let instruction = (navigationService.currentStep?.instructions ?? "").lowercased()
        if instruction.contains("u-turn") { return "arrow.uturn.down" }
        if instruction.contains("slight left") { return "arrow.up.left" }
        if instruction.contains("slight right") { return "arrow.up.right" }
        if instruction.contains("left") { return "arrow.turn.up.left" }
        if instruction.contains("right") { return "arrow.turn.up.right" }
        if instruction.contains("arriv") { return "mappin.circle.fill" }
        return "arrow.up"
    }
}

/// The bar along the bottom while navigating: ETA, remaining distance, and the
/// two things a driver actually reaches for — report and end.
struct GuidanceCard: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var navigationService: NavigationService

    let onReport: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(arrivalText)
                    .font(.title3.weight(.bold))
                Text("\(remainingTimeText) · \(remainingDistanceText)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button(action: onReport) {
                Image(systemName: "exclamationmark.bubble.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 46, height: 46)
                    .background(Color.orange.opacity(0.18), in: Circle())
                    .foregroundStyle(.orange)
            }
            .buttonStyle(.plain)

            Button {
                environment.cancelTrip()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 46, height: 46)
                    .background(Color.red.opacity(0.15), in: Circle())
                    .foregroundStyle(.red)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var arrivalText: String {
        navigationService.progress.estimatedArrival.formatted(date: .omitted, time: .shortened)
    }

    private var remainingTimeText: String {
        Duration.seconds(navigationService.progress.timeRemaining)
            .formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    private var remainingDistanceText: String {
        MeasurementFormatter.distance.string(
            from: Measurement(
                value: navigationService.progress.distanceRemaining,
                unit: UnitLength.meters
            )
        )
    }
}

/// Route choices, each showing what the weather will do to it. This is the
/// screen the whole app exists for.
struct RoutePreviewCard: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var navigationService: NavigationService

    @State private var selectedID: UUID?

    var body: some View {
        VStack(spacing: 12) {
            ForEach(navigationService.routeOptions) { option in
                Button {
                    selectedID = option.id
                    navigationService.update(option)
                } label: {
                    RouteRow(option: option, isSelected: isSelected(option))
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 12) {
                Button("Cancel") {
                    environment.cancelTrip()
                }
                .font(.body.weight(.medium))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .foregroundStyle(.primary)

                Button("Go") {
                    guard let option = chosenOption else { return }
                    environment.startTrip(option)
                }
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .foregroundStyle(.white)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var chosenOption: RouteOption? {
        navigationService.routeOptions.first { $0.id == selectedID }
            ?? navigationService.routeOptions.first
    }

    private func isSelected(_ option: RouteOption) -> Bool {
        chosenOption?.id == option.id
    }
}

struct RouteRow: View {
    let option: RouteOption
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(option.name)
                    .font(.headline)
                    .lineLimit(1)
                Text(option.summary())
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if let worst = worstWeather {
                    Label {
                        Text(weatherText(worst))
                    } icon: {
                        Image(systemName: worst.snapshot.condition.symbolName)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color(uiColor: worst.severity.overlayColor))
                }
            }

            Spacer(minLength: 0)

            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary.opacity(0.5))
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isSelected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.08))
        )
    }

    private var worstWeather: RouteWeatherSegment? {
        option.weatherSegments
            .filter { $0.severity >= .moderate }
            .max { $0.severity < $1.severity }
    }

    private func weatherText(_ segment: RouteWeatherSegment) -> String {
        let place = segment.placeName.map { " near \($0)" } ?? ""
        let distance = MeasurementFormatter.distance.string(
            from: Measurement(value: segment.distanceAlongRoute, unit: UnitLength.meters)
        )
        return "\(segment.snapshot.condition.description)\(place) · \(distance) in"
    }
}
