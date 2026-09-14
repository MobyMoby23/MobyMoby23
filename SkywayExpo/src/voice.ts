import * as Speech from 'expo-speech';
import { formatDistance } from './core/alerts';
import type { DriverAlert } from './core/alerts';
import type { RouteStep } from './core/routing/types';
import { useSkyway } from './state/store';

/**
 * Spoken guidance and warnings.
 *
 * The two moments that matter for a turn are far enough out to change lane,
 * and the turn itself. Advance distance scales with speed — about 25 seconds
 * of travel — so the warning arrives at the same *time* whether the driver is
 * in a village or on a motorway.
 */
class VoiceGuidance {
  private spoken = new Set<string>();
  private currentStepIndex = -1;

  reset(): void {
    this.spoken.clear();
    this.currentStepIndex = -1;
    Speech.stop();
  }

  private get muted(): boolean {
    return useSkyway.getState().muted;
  }

  speak(text: string, interrupt = false): void {
    if (this.muted) return;
    if (interrupt) Speech.stop();
    Speech.speak(text, { rate: 1.0, pitch: 1.0 });
  }

  announceStep(step: RouteStep, stepIndex: number, distanceToManeuver: number, speed: number): void {
    if (this.muted) return;

    if (stepIndex !== this.currentStepIndex) {
      this.currentStepIndex = stepIndex;
      // Drop keys from steps already passed so the set can't grow all trip.
      this.spoken = new Set([...this.spoken].filter((key) => key.startsWith(`${stepIndex}-`)));
    }

    const advanceDistance = Math.max(200, Math.min(speed * 25, 1_600));

    if (distanceToManeuver <= advanceDistance && distanceToManeuver > advanceDistance * 0.4) {
      const key = `${stepIndex}-advance`;
      if (this.spoken.has(key)) return;
      this.spoken.add(key);
      this.speak(`In ${formatDistance(distanceToManeuver)}, ${step.instruction}`);
    } else if (distanceToManeuver <= 80) {
      const key = `${stepIndex}-now`;
      if (this.spoken.has(key)) return;
      this.spoken.add(key);
      this.speak(step.instruction);
    }
  }

  /** Alerts jump the queue — a hazard 400 m ahead outranks "in 2 km, keep left". */
  announceAlert(alert: DriverAlert): void {
    this.speak(alert.spokenText, alert.severity >= 3);
  }

  announceArrival(name: string): void {
    this.speak(`You have arrived at ${name}.`);
  }
}

export const voice = new VoiceGuidance();
