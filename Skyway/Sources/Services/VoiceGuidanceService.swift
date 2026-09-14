import Foundation
import AVFoundation
import MapKit
import Combine

/// Spoken turn instructions and alerts.
///
/// Uses `.duckOthers` rather than interrupting so the driver's music dips for
/// the instruction and comes back, which is what every in-car app should do
/// and what CarPlay users expect.
@MainActor
final class VoiceGuidanceService: NSObject, ObservableObject {

    @Published var isMuted = false

    private let synthesizer = AVSpeechSynthesizer()
    /// Instructions already spoken for the current step, keyed by step index
    /// and the trigger band, so "in 500 metres" and "turn now" each fire once.
    private var spoken = Set<String>()
    private var currentStepIndex = -1

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .voicePrompt,
                options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
            )
        } catch {
            NSLog("[Skyway] audio session error: %@", error.localizedDescription)
        }
    }

    func reset() {
        spoken.removeAll()
        currentStepIndex = -1
        synthesizer.stopSpeaking(at: .immediate)
    }

    /// Speaks a turn instruction at the two useful moments: far enough out to
    /// change lane, and at the turn itself.
    func announceIfNeeded(step: MKRoute.Step, stepIndex: Int, distanceToManeuver: CLLocationDistance, speed: CLLocationSpeed) {
        guard !isMuted, !step.instructions.isEmpty else { return }

        if stepIndex != currentStepIndex {
            currentStepIndex = stepIndex
            spoken = spoken.filter { $0.hasPrefix("\(stepIndex)-") }
        }

        // Advance warning scales with speed: ~25 seconds of travel, floored so
        // it still works when stopped at lights.
        let advanceDistance = max(200, min(speed * 25, 1_600))

        if distanceToManeuver <= advanceDistance, distanceToManeuver > advanceDistance * 0.4 {
            let key = "\(stepIndex)-advance"
            guard spoken.insert(key).inserted else { return }
            let distanceText = MeasurementFormatter.distance.string(
                from: Measurement(value: distanceToManeuver, unit: UnitLength.meters)
            )
            speak("In \(distanceText), \(step.instructions)")
        } else if distanceToManeuver <= 80 {
            let key = "\(stepIndex)-now"
            guard spoken.insert(key).inserted else { return }
            speak(step.instructions)
        }
    }

    /// Alerts jump the queue — a hazard 400 m ahead outranks "in 2 kilometres,
    /// keep left".
    func announce(_ alert: DriverAlert) {
        guard !isMuted else { return }
        if alert.severity >= .high { synthesizer.stopSpeaking(at: .word) }
        speak(alert.spokenText)
    }

    func announceArrival(at destination: Destination) {
        guard !isMuted else { return }
        speak("You have arrived at \(destination.name).")
    }

    func speak(_ text: String) {
        guard !isMuted else { return }
        let utterance = AVSpeechUtterance(string: text)
        // AVSpeechSynthesisVoice wants BCP-47 ("en-GB"), not a POSIX locale
        // identifier ("en_GB"), and returns nil rather than complaining.
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier(.bcp47))
            ?? AVSpeechSynthesisVoice(language: "en-GB")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.postUtteranceDelay = 0.1

        activateSession()
        synthesizer.speak(utterance)
    }

    private func activateSession() {
        try? AVAudioSession.sharedInstance().setActive(true)
    }
}

extension VoiceGuidanceService: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        // Hand the audio route back so the driver's music un-ducks promptly.
        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
    }
}
