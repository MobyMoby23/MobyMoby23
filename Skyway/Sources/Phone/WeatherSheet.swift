import SwiftUI

/// The full weather picture: here, along the route, and on arrival.
struct WeatherSheet: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var navigationService: NavigationService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let current = environment.currentWeather {
                    Section("Here now") {
                        CurrentWeatherRow(snapshot: current)
                    }
                }

                if !routeSegments.isEmpty {
                    Section("On your route") {
                        ForEach(routeSegments) { segment in
                            RouteWeatherRow(segment: segment)
                        }
                    }
                } else if navigationService.activeRoute != nil {
                    Section("On your route") {
                        Label("Clear all the way", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                if !environment.destinationForecast.isEmpty {
                    Section("At \(navigationService.destination?.name ?? "your destination")") {
                        ForEach(environment.destinationForecast.prefix(8)) { hour in
                            HStack {
                                Text(hour.date, format: .dateTime.hour())
                                    .frame(width: 64, alignment: .leading)
                                Image(systemName: hour.condition.symbolName)
                                    .symbolRenderingMode(.multicolor)
                                    .frame(width: 30)
                                Text(hour.condition.description)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                if hour.precipitationChance > 0.1 {
                                    Text("\(Int(hour.precipitationChance * 100))%")
                                        .font(.caption)
                                        .foregroundStyle(.blue)
                                }
                                Text("\(Int(hour.temperature.rounded()))°")
                                    .fontWeight(.medium)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Weather")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var routeSegments: [RouteWeatherSegment] {
        navigationService.activeRoute?.weatherSegments
            ?? navigationService.routeOptions.first?.weatherSegments
            ?? []
    }
}

struct CurrentWeatherRow: View {
    let snapshot: WeatherSnapshot

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: snapshot.condition.symbolName)
                .symbolRenderingMode(.multicolor)
                .font(.system(size: 40))

            VStack(alignment: .leading, spacing: 4) {
                Text("\(Int(snapshot.temperature.rounded()))°")
                    .font(.system(size: 32, weight: .semibold, design: .rounded))
                Text(snapshot.condition.description)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                detail("wind", "\(Int((snapshot.windSpeed * 3.6).rounded())) km/h")
                if let visibility = snapshot.visibility, visibility < 5_000 {
                    detail("visibility", "\(Int(visibility)) m")
                }
                if snapshot.precipitationChance > 0.1 {
                    detail("rain", "\(Int(snapshot.precipitationChance * 100))%")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }

    private func detail(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label)
            Text(value).fontWeight(.medium).foregroundStyle(.primary)
        }
    }
}

struct RouteWeatherRow: View {
    let segment: RouteWeatherSegment

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: segment.snapshot.condition.symbolName)
                .symbolRenderingMode(.multicolor)
                .font(.title2)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 3) {
                Text(segment.snapshot.condition.description)
                    .fontWeight(.medium)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("\(Int(segment.snapshot.temperature.rounded()))°")
                .foregroundStyle(.secondary)

            Circle()
                .fill(Color(uiColor: segment.severity.overlayColor))
                .frame(width: 10, height: 10)
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        let distance = MeasurementFormatter.distance.string(
            from: Measurement(value: segment.distanceAlongRoute, unit: UnitLength.meters)
        )
        let arrival = segment.arrivalTime.formatted(date: .omitted, time: .shortened)
        if let place = segment.placeName {
            return "\(place) · \(distance) in · around \(arrival)"
        }
        return "\(distance) in · around \(arrival)"
    }
}
