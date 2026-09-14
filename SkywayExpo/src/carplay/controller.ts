import {
  addBarButtonPressedListener,
  addConnectListener,
  addDisconnectListener,
  addMapButtonPressedListener,
  addSearchResultSelectedListener,
  addSearchTextListener,
  addTripPreviewSelectedListener,
  addTripStartedListener,
  createMapTemplate,
  createSearchTemplate,
  hideTripPreviews,
  popTemplate,
  pushTemplate,
  setCarPlayRoute,
  setFollowMode,
  setRootTemplate,
  showTripPreviews,
  startNavigation,
  stopNavigation,
  updateManeuvers,
  updateMapTemplateButtons,
  updateSearchResults,
  updateTravelEstimates,
} from '@bradford-tech/expo-carplay';
import type { MapButtonConfig, RouteSegment, TripConfig } from '@bradford-tech/expo-carplay';

import { DriverAlert, formatDistance, formatDuration } from '../core/alerts';
import { cumulativeDistances, sliceRoute } from '../core/geo';
import { INCIDENT_LABEL, IncidentKind } from '../core/incidents/types';
import { maneuverSymbol } from '../core/routing/types';
import type { Place, Route } from '../core/routing/types';
import {
  CONDITION_LABEL,
  SEVERITY_COLOR,
  Severity,
  snapshotSeverity,
} from '../core/weather/types';
import {
  addSkywayListener,
  cancelTrip,
  planTrip,
  reportIncident,
  selectRoute,
  selectedRoute,
  skyway,
  startTrip,
  useSkyway,
} from '../state/store';
import { voice } from '../voice';

/**
 * Drives the car screen.
 *
 * Deliberately outside React: CarPlay is driven by native scene events, not by
 * a component tree, and the car can connect while the phone app has never been
 * opened. It reads and writes the same store the phone UI uses, so a trip
 * started in the driveway is already running when the car connects.
 *
 * Two things this module's CarPlay support does not yet expose shape the
 * design here, and both have workarounds that stay within supported API:
 *
 *  - **No navigation alert banner.** Hazard and weather warnings are spoken
 *    (which is the channel that matters at speed) and mirrored into a coloured
 *    pill map button, which is as close to a banner as the API allows.
 *  - **No grid or list templates.** Reporting is a two-tap flow that swaps the
 *    map buttons into report pills; the weather summary is spoken rather than
 *    listed.
 */

/** Report kinds offered on the car screen — the three a driver actually files. */
const QUICK_REPORTS: IncidentKind[] = ['police', 'crash', 'heavyTraffic'];

/** How long the report pills stay up before reverting to the normal buttons. */
const REPORT_MODE_TIMEOUT = 8_000;

const BUTTON = {
  search: 'search',
  weather: 'weather',
  report: 'report',
  endTrip: 'end-trip',
  recentre: 'recentre',
  alert: 'alert',
  cancelReport: 'cancel-report',
} as const;

class CarPlayController {
  private mapTemplateId: string | null = null;
  private searchTemplateId: string | null = null;
  private subscriptions: { remove(): void }[] = [];
  private unsubscribeStore: (() => void) | null = null;

  private reportModeTimer: ReturnType<typeof setTimeout> | null = null;
  private inReportMode = false;
  private activeAlert: DriverAlert | null = null;

  private searchResults: Place[] = [];
  private previewedRoutes: Route[] = [];
  private navigating = false;
  private lastEstimateAt = 0;
  private lastDrawnRouteKey = '';

  /** Called once at app start; the listeners survive connect/disconnect cycles. */
  install(): void {
    this.subscriptions.push(
      addConnectListener(() => void this.onConnect()),
      addDisconnectListener(() => this.onDisconnect()),
      addBarButtonPressedListener(({ id }) => void this.onBarButton(id)),
      addMapButtonPressedListener(({ id }) => void this.onMapButton(id)),
      addSearchTextListener(({ requestId, searchText }) =>
        void this.onSearchText(requestId, searchText),
      ),
      addSearchResultSelectedListener((event) => void this.onSearchResult(event)),
      addTripPreviewSelectedListener(({ routeIndex }) => this.onPreviewSelected(routeIndex)),
      addTripStartedListener(({ routeIndex }) => void this.onTripStarted(routeIndex)),
    );

    addSkywayListener({
      onAlert: (alert) => this.showAlert(alert),
      onRouteChanged: (route) => void this.drawRoute(route),
      onArrived: () => void this.onArrived(),
      onStepChanged: () => void this.pushManeuver(),
    });
  }

  uninstall(): void {
    this.subscriptions.forEach((subscription) => subscription.remove());
    this.subscriptions = [];
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

  // -------------------------------------------------------------------------
  // Scene lifecycle
  // -------------------------------------------------------------------------

  private async onConnect(): Promise<void> {
    useSkyway.setState({ carPlayConnected: true });

    this.mapTemplateId = await createMapTemplate({
      leadingNavigationBarButtons: [
        { id: BUTTON.search, systemImage: 'magnifyingglass' },
        { id: BUTTON.weather, systemImage: 'cloud.sun.fill' },
      ],
      trailingNavigationBarButtons: [{ id: BUTTON.report, systemImage: 'exclamationmark.bubble.fill' }],
      mapButtons: this.normalMapButtons(),
      guidanceBackgroundColor: '#12161F',
    });

    await setRootTemplate(this.mapTemplateId);
    await setFollowMode('browseHeadingUp');

    // The car may connect mid-trip — the phone half runs independently, so
    // pick up whatever is already in flight rather than starting from idle.
    const route = selectedRoute();
    const { tripState } = useSkyway.getState();
    if (route && tripState === 'navigating') {
      await this.drawRoute(route);
      await setFollowMode('navigation');
      this.navigating = true;
      await this.pushManeuver();
    } else if (route && tripState === 'previewing') {
      await this.presentPreviews();
    }

    this.subscribeToProgress();
  }

  private onDisconnect(): void {
    useSkyway.setState({ carPlayConnected: false });
    this.mapTemplateId = null;
    this.searchTemplateId = null;
    this.navigating = false;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

  /**
   * Travel estimates are pushed on a timer rather than on every fix: the
   * guidance panel only shows whole units, so a 1 Hz bridge round-trip would
   * be work nobody sees.
   */
  private subscribeToProgress(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = skyway.subscribe((state) => {
      if (!this.navigating || state.tripState !== 'navigating') return;

      const now = Date.now();
      if (now - this.lastEstimateAt < 1_000) return;
      this.lastEstimateAt = now;

      void updateTravelEstimates(
        {
          distanceRemaining: state.progress.distanceRemaining,
          timeRemaining: state.progress.timeRemaining,
        },
        0,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------

  private normalMapButtons(): MapButtonConfig[] {
    const buttons: MapButtonConfig[] = [{ id: BUTTON.recentre, systemImage: 'location.fill' }];

    // The alert pill stands in for the navigation alert banner this module
    // does not expose yet. Hidden until something is actually wrong.
    if (this.activeAlert) {
      buttons.unshift({
        id: BUTTON.alert,
        title: `${this.activeAlert.title} · ${formatDistance(this.activeAlert.distanceAhead)}`,
        backgroundColor: this.activeAlert.color,
      });
    }

    return buttons;
  }

  private reportMapButtons(): MapButtonConfig[] {
    // CarPlay shows at most three map buttons, which is exactly the number of
    // report kinds worth offering while moving.
    return QUICK_REPORTS.map((kind) => ({
      id: `report-${kind}`,
      title: INCIDENT_LABEL[kind],
      backgroundColor: '#FF9F0A',
    }));
  }

  private async refreshMapButtons(): Promise<void> {
    if (!this.mapTemplateId) return;
    await updateMapTemplateButtons({
      mapButtons: this.inReportMode ? this.reportMapButtons() : this.normalMapButtons(),
    });
  }

  private async onBarButton(id: string): Promise<void> {
    switch (id) {
      case BUTTON.search:
        await this.presentSearch();
        break;
      case BUTTON.weather:
        this.speakWeatherSummary();
        break;
      case BUTTON.report:
        await this.enterReportMode();
        break;
      case BUTTON.endTrip:
        await this.endTrip();
        break;
      default:
        break;
    }
  }

  private async onMapButton(id: string): Promise<void> {
    if (id === BUTTON.recentre) {
      await setFollowMode(this.navigating ? 'navigation' : 'browseHeadingUp');
      return;
    }

    if (id === BUTTON.alert) {
      // Tapping the pill confirms the hazard, the way "Still there" would on a
      // navigation alert.
      const incident = this.activeAlert?.incident;
      if (incident) {
        const { voteOnIncident } = await import('../state/store');
        await voteOnIncident(incident.id, true);
        voice.speak('Thanks, confirmed.');
      }
      this.activeAlert = null;
      await this.refreshMapButtons();
      return;
    }

    if (id.startsWith('report-')) {
      const kind = id.slice('report-'.length) as IncidentKind;
      await this.exitReportMode();
      const incident = await reportIncident(kind);
      if (incident) voice.speak(`${INCIDENT_LABEL[kind]} reported. Thanks.`);
    }
  }

  private async enterReportMode(): Promise<void> {
    this.inReportMode = true;
    await this.refreshMapButtons();

    if (this.reportModeTimer) clearTimeout(this.reportModeTimer);
    this.reportModeTimer = setTimeout(() => void this.exitReportMode(), REPORT_MODE_TIMEOUT);
  }

  private async exitReportMode(): Promise<void> {
    if (this.reportModeTimer) {
      clearTimeout(this.reportModeTimer);
      this.reportModeTimer = null;
    }
    if (!this.inReportMode) return;
    this.inReportMode = false;
    await this.refreshMapButtons();
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  private async presentSearch(): Promise<void> {
    this.searchTemplateId = await createSearchTemplate();
    await pushTemplate(this.searchTemplateId);
  }

  private async onSearchText(requestId: string, searchText: string): Promise<void> {
    const { location } = useSkyway.getState();
    try {
      this.searchResults = await skyway.routing.search(searchText, location ?? undefined);
    } catch {
      this.searchResults = [];
    }

    await updateSearchResults(
      requestId,
      this.searchResults.map((place) => ({
        text: place.name,
        detailText: place.subtitle,
      })),
    );
  }

  private async onSearchResult(event: { text: string; detailText: string }): Promise<void> {
    // The module hands back the row's text rather than its index, so match on
    // both fields to avoid picking the wrong one of two identically named POIs.
    const place =
      this.searchResults.find(
        (candidate) => candidate.name === event.text && candidate.subtitle === event.detailText,
      ) ?? this.searchResults.find((candidate) => candidate.name === event.text);

    if (!place) return;

    await popTemplate();
    await planTrip(place);
    await this.presentPreviews();
  }

  // -------------------------------------------------------------------------
  // Trip previews
  // -------------------------------------------------------------------------

  /**
   * Shows the route choices, each carrying its weather on the second line.
   * This is the screen the whole app exists for: the reason to pick the
   * slower route is right there under it.
   */
  private async presentPreviews(): Promise<void> {
    const { location, destination, routes } = useSkyway.getState();
    if (!location || !destination || routes.length === 0) return;

    this.previewedRoutes = routes;

    const trip: TripConfig = {
      origin: { ...location, name: 'Current location' },
      destination: { ...destination.coordinate, name: destination.name },
      routeChoices: routes.slice(0, 3).map((route) => ({
        summaryVariants: [
          `${formatDuration(route.duration)} · ${formatDistance(route.distance)}`,
          formatDuration(route.duration),
        ],
        additionalInformationVariants: [this.weatherLine(route)],
      })),
    };

    await showTripPreviews([trip]);
    await this.drawRoute(routes[0]);
  }

  /** The second line under a route choice: the reason to pick the slower one. */
  private weatherLine(route: Route): string {
    const parts: string[] = [];

    const worst = route.weather.reduce<(typeof route.weather)[number] | null>(
      (found, segment) =>
        !found || snapshotSeverity(segment.snapshot) > snapshotSeverity(found.snapshot)
          ? segment
          : found,
      null,
    );

    if (worst && snapshotSeverity(worst.snapshot) >= Severity.moderate) {
      const place = worst.placeName ? ` near ${worst.placeName}` : '';
      parts.push(`${CONDITION_LABEL[worst.snapshot.condition]}${place}`);
    } else if (route.weather.length > 0) {
      parts.push('Clear conditions');
    }

    if (route.incidents.length > 0) {
      const kinds = [...new Set(route.incidents.map((incident) => INCIDENT_LABEL[incident.kind]))];
      parts.push(kinds.sort().join(', '));
    }

    return parts.length > 0 ? parts.join(' · ') : 'Checking weather…';
  }

  private onPreviewSelected(routeIndex: number): void {
    // Scrolling between choices redraws the map, so the driver sees the
    // alternative and its weather bands before committing.
    const route = this.previewedRoutes[routeIndex];
    if (!route) return;
    selectRoute(route.id);
    void this.drawRoute(route);
  }

  private async onTripStarted(routeIndex: number): Promise<void> {
    const route = this.previewedRoutes[routeIndex] ?? selectedRoute();
    if (!route) return;

    await hideTripPreviews();
    startTrip(route);

    const { location, destination } = useSkyway.getState();
    if (!location || !destination) return;

    await startNavigation({
      origin: { ...location, name: 'Current location' },
      destination: { ...destination.coordinate, name: destination.name },
      routeChoices: [
        {
          summaryVariants: [`${formatDuration(route.duration)} · ${formatDistance(route.distance)}`],
        },
      ],
    });

    this.navigating = true;
    await setFollowMode('navigation');
    await this.drawRoute(route);
    await this.pushManeuver();
    await this.updateEndTripButton(true);
  }

  private async endTrip(): Promise<void> {
    await stopNavigation();
    await hideTripPreviews();
    cancelTrip();
    this.navigating = false;
    this.activeAlert = null;
    await setFollowMode('browseHeadingUp');
    await this.refreshMapButtons();
    await this.updateEndTripButton(false);
  }

  private async onArrived(): Promise<void> {
    await stopNavigation();
    this.navigating = false;
    await setFollowMode('browseHeadingUp');
    await this.updateEndTripButton(false);
  }

  private async updateEndTripButton(navigating: boolean): Promise<void> {
    if (!this.mapTemplateId) return;
    await updateMapTemplateButtons({
      leadingNavigationBarButtons: [
        { id: BUTTON.search, systemImage: 'magnifyingglass' },
        { id: BUTTON.weather, systemImage: 'cloud.sun.fill' },
      ],
      trailingNavigationBarButtons: navigating
        ? [
            { id: BUTTON.report, systemImage: 'exclamationmark.bubble.fill' },
            { id: BUTTON.endTrip, systemImage: 'xmark.circle.fill' },
          ]
        : [{ id: BUTTON.report, systemImage: 'exclamationmark.bubble.fill' }],
    });
  }

  // -------------------------------------------------------------------------
  // Guidance
  // -------------------------------------------------------------------------

  private async pushManeuver(): Promise<void> {
    if (!this.navigating) return;
    const route = selectedRoute();
    const { progress } = useSkyway.getState();
    const step = route?.steps[progress.stepIndex];
    if (!step) return;

    await updateManeuvers([
      {
        // Variants let CarPlay pick the longest that fits: a widescreen head
        // unit gets the full instruction, a 7-inch one the short form.
        instructionVariants: [step.instruction, step.shortInstruction ?? step.instruction].filter(
          (value, index, all) => all.indexOf(value) === index,
        ),
        symbolImage: { systemName: maneuverSymbol(step) },
        distanceRemaining: progress.distanceToNextManeuver,
        timeRemaining: step.duration,
      },
    ]);
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /**
   * Draws the route, painted by weather severity.
   *
   * The bands are the whole visual idea: a glance at the line tells the driver
   * where the bad stretch is without reading anything.
   */
  private async drawRoute(route: Route): Promise<void> {
    const key = `${route.id}:${route.weather.length}`;
    if (key === this.lastDrawnRouteKey) return;
    this.lastDrawnRouteKey = key;

    const cumulative = cumulativeDistances(route.coordinates);
    const segments: RouteSegment[] = [
      { coordinates: route.coordinates, color: SEVERITY_COLOR[Severity.none] },
    ];

    for (const weather of route.weather) {
      const severity = snapshotSeverity(weather.snapshot);
      if (severity < Severity.moderate) continue;

      // A 6 km band centred on the sample — roughly the resolution the
      // forecast actually has.
      const band = sliceRoute(
        weather.distanceAlongRoute - 3_000,
        weather.distanceAlongRoute + 3_000,
        route.coordinates,
        cumulative,
      );
      if (band.length >= 2) {
        segments.push({ coordinates: band, color: SEVERITY_COLOR[severity] });
      }
    }

    await setCarPlayRoute(segments);
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  private showAlert(alert: DriverAlert): void {
    this.activeAlert = alert;
    void this.refreshMapButtons();

    setTimeout(() => {
      if (this.activeAlert?.id !== alert.id) return;
      this.activeAlert = null;
      void this.refreshMapButtons();
    }, 12_000);
  }

  /**
   * Spoken rather than listed: there is no list template yet, and a summary
   * read aloud is the right channel for a driver anyway.
   */
  private speakWeatherSummary(): void {
    const { currentWeather } = useSkyway.getState();
    const route = selectedRoute();

    const lines: string[] = [];
    if (currentWeather) {
      lines.push(
        `Currently ${CONDITION_LABEL[currentWeather.condition].toLowerCase()}, ${Math.round(currentWeather.temperature)} degrees.`,
      );
    }

    const notable = (route?.weather ?? []).filter(
      (segment) => snapshotSeverity(segment.snapshot) >= Severity.moderate,
    );

    if (!route) {
      lines.push('No route set.');
    } else if (notable.length === 0) {
      lines.push('Clear conditions the whole way.');
    } else {
      for (const segment of notable.slice(0, 3)) {
        const place = segment.placeName ? ` near ${segment.placeName}` : '';
        lines.push(
          `${CONDITION_LABEL[segment.snapshot.condition]}${place} in ${formatDistance(segment.distanceAlongRoute)}.`,
        );
      }
    }

    voice.speak(lines.join(' '), true);
  }
}

export const carPlay = new CarPlayController();
