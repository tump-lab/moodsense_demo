import CryptoKit
import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import SwiftUI
import UIKit

/**
 * iOS screen time is quantized: DeviceActivity only reports that a preset threshold was crossed,
 * so this gives buckets, not Android's millisecond totals. Without the Family Controls
 * entitlement every call fails soft and `authorizationStatus` reports `unavailable`.
 */
@MainActor
final class ScreenTimeController {
  static let shared = ScreenTimeController()

  // `total` only works because the participant selects every category in the picker, so it
  // is a floor on device screen time, not a true total.
  static let categories = ["social", "audioVideo", "total"]

  static func pickerTitle(for category: String) -> String {
    switch category {
    case "social": return "Social apps"
    case "audioVideo": return "Audio & video apps"
    default: return "All apps — select every category"
    }
  }

  /**
   * Shown inside the system picker. The app cannot tick a single box here — Apple hands back opaque
   * tokens and offers no way to build one, so there is no API that pre-selects "Social" or Netflix
   * (see docs/SENSING.md, "The opaque-token problem"). Telling the participant exactly which one row
   * to tap is the whole of what is available, so these strings are the feature, not decoration:
   * tapping a category once is a second of work, where picking apps one by one is why nobody does it.
   */
  static func pickerHeader(for category: String) -> String {
    switch category {
    case "social":
      return "Tap the Social row to include every social app at once — you do not need to pick them one by one."
    case "audioVideo":
      return "Tap the Entertainment row to include every video and audio app at once — YouTube, Netflix, Bilibili, podcasts and the rest."
    default:
      return "Select every category, so this counts your whole phone rather than a few apps."
    }
  }

  static func pickerFooter(for category: String) -> String {
    switch category {
    case "total":
      return "MoodSense only ever learns that a daily time mark was passed. It never learns which apps you picked."
    default:
      return "Tapping the whole row is enough. MoodSense never learns which apps are in it — only that the group passed a daily time mark."
    }
  }

  private let activityName = DeviceActivityName("moodsense.daily")

  private let center = DeviceActivityCenter()

  /**
   * `unavailable` means this build cannot ask at all (no entitlement or App Group), which is not
   * the same as `denied`. Only the two negative cases are matched because Apple keeps adding
   * approved variants.
   */
  func authorizationStatus() -> String {
    guard SharedStore.appGroupId != nil else { return "unavailable" }
    let status = AuthorizationCenter.shared.authorizationStatus
    if status == .notDetermined { return "notDetermined" }
    if status == .denied { return "denied" }
    return "approved"
  }

  func requestAuthorization(completion: @escaping (String) -> Void) {
    guard SharedStore.appGroupId != nil else {
      completion("unavailable")
      return
    }
    Task {
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        completion(self.authorizationStatus())
      } catch {
        completion(self.authorizationStatus() == "approved" ? "approved" : "denied")
      }
    }
  }

  private func decodeSelection(_ category: String) -> FamilyActivitySelection? {
    guard let data = SharedStore.selectionData(for: category) else { return nil }
    return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  private func encodeAndStore(_ selection: FamilyActivitySelection, for category: String) {
    guard let data = try? JSONEncoder().encode(selection) else { return }
    SharedStore.setSelectionData(data, for: category)
  }

  func selectionSummary() -> [String: Any] {
    var summary: [String: Any] = [:]
    for category in Self.categories {
      let selection = decodeSelection(category)
      summary[category] = [
        "applications": selection?.applicationTokens.count ?? 0,
        "categories": selection?.categoryTokens.count ?? 0,
      ]
    }
    return summary
  }

  func clearSelections() {
    for category in Self.categories {
      SharedStore.setSelectionData(nil, for: category)
    }
  }

  /**
   * The apps that get their own event ladder: every individually picked app across the buckets,
   * ordered by id and capped at `maxTrackedApps`. `startMonitoring` applies the identical rule, and
   * the labeller shows this list, so the participant is never asked to name an app whose usage is
   * not actually recorded on its own.
   */
  func trackedApps() -> [TrackedApp] {
    var picked: [String: ApplicationToken] = [:]
    for category in Self.categories {
      guard let selection = decodeSelection(category) else { continue }
      for token in selection.applicationTokens {
        if let id = Self.appId(for: token) { picked[id] = token }
      }
    }
    return picked.keys.sorted().prefix(Self.maxTrackedApps).compactMap { id in
      picked[id].map { TrackedApp(id: id, token: $0) }
    }
  }

  func appLabels() -> [String: String] {
    SharedStore.appLabels()
  }

  /**
   * Lets the participant put a name to each tracked app. iOS renders the real icon and title through
   * `Label(ApplicationToken)` but never hands the string over, so the name that gets recorded is the
   * one the participant typed — that is the whole reason this screen exists rather than a lookup.
   * Labels for apps no longer tracked are dropped on save, so a name can never outlive its app.
   */
  func presentAppLabeler(completion: @escaping ([String: Any]) -> Void) {
    guard authorizationStatus() == "approved" else {
      completion(["cancelled": true, "reason": "not authorized", "labels": appLabels()])
      return
    }
    let apps = trackedApps()
    guard !apps.isEmpty else {
      completion(["cancelled": true, "reason": "no tracked apps", "labels": appLabels()])
      return
    }
    guard let presenter = Self.topViewController() else {
      completion(["cancelled": true, "reason": "no view controller", "labels": appLabels()])
      return
    }

    let model = LabelModel(apps: apps, names: SharedStore.appLabels())
    var host: UIHostingController<AppLabelView>?

    let finish: (Bool) -> Void = { saved in
      if saved {
        var kept: [String: String] = [:]
        for app in apps {
          let name = (model.names[app.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
          if !name.isEmpty { kept[app.id] = name }
        }
        SharedStore.setAppLabels(kept)
      }
      host?.dismiss(animated: true)
      completion(["cancelled": !saved, "labels": SharedStore.appLabels()])
    }

    host = UIHostingController(
      rootView: AppLabelView(model: model, onDone: { finish(true) }, onCancel: { finish(false) })
    )
    // Every exit from here has to call `completion`. JS awaits it, and a path that returns without
    // answering leaves that promise pending for the life of the process — which on the consent
    // screen is a button that spins and never moves on.
    guard let host else {
      completion(["cancelled": true, "reason": "no host controller", "labels": appLabels()])
      return
    }
    host.modalPresentationStyle = .formSheet
    presenter.present(host, animated: true)
  }

  func presentPicker(category: String, completion: @escaping ([String: Any]) -> Void) {
    guard Self.categories.contains(category) else {
      completion(["cancelled": true, "reason": "unknown category"])
      return
    }
    guard authorizationStatus() == "approved" else {
      completion(["cancelled": true, "reason": "not authorized"])
      return
    }
    guard let presenter = Self.topViewController() else {
      completion(["cancelled": true, "reason": "no view controller"])
      return
    }

    let model = PickerModel(
      selection: decodeSelection(category) ?? FamilyActivitySelection(includeEntireCategory: true)
    )
    var host: UIHostingController<ActivityPickerView>?

    // `answered` makes the completion run at most once. SwiftUI can fire a toolbar action twice on a
    // fast double tap, and an Expo promise rejects on its second resolve.
    var answered = false
    let finish: (Bool) -> Void = { [weak self] saved in
      if answered { return }
      answered = true
      host?.dismiss(animated: true)
      guard let self else {
        // Unreachable in practice (this is a singleton), but a silent return here would leave the
        // awaiting JS promise pending forever rather than reporting a cancel.
        completion(["cancelled": true, "reason": "controller released"])
        return
      }
      if saved {
        self.encodeAndStore(model.selection, for: category)
      }
      var result = self.selectionSummary()
      result["cancelled"] = !saved
      completion(result)
    }

    host = UIHostingController(
      rootView: ActivityPickerView(
        model: model,
        title: Self.pickerTitle(for: category),
        headerText: Self.pickerHeader(for: category),
        footerText: Self.pickerFooter(for: category),
        onDone: { finish(true) },
        onCancel: { finish(false) }
      )
    )
    guard let host else {
      completion(["cancelled": true, "reason": "no host controller"])
      return
    }
    host.modalPresentationStyle = .formSheet
    presenter.present(host, animated: true)
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    guard var top = scene?.keyWindow?.rootViewController else { return nil }
    while let presented = top.presentedViewController {
      top = presented
    }
    return top
  }

  /**
   * Each tracked app adds a full ladder of events, so apps past this are covered only by their group.
   * Kept small on purpose: DeviceActivity has an undocumented ceiling on how many events one activity may
   * carry, and past it `startMonitoring` either throws or registers events that never fire. See
   * `eventBudget` below for the running total.
   */
  static let maxTrackedApps = 5

  /**
   * Hard cap on the events handed to one `startMonitoring` call. Apple documents no number, and the
   * failure past it is silent — no crossings ever arrive — so this errs low and drops the least
   * useful events (the highest per-app rungs) rather than gambling the whole plan.
   */
  static let eventBudget = 100

  /**
   * A stable, anonymous id for an app on this device. iOS never reveals which app a token is, so this only lets
   * rows for the same app be grouped together.
   */
  static func appId(for token: ApplicationToken) -> String? {
    guard let data = try? JSONEncoder().encode(token) else { return nil }
    return SHA256.hash(data: data).prefix(6).map { String(format: "%02x", $0) }.joined()
  }

  private static func event(
    applications: Set<ApplicationToken>,
    categories: Set<ActivityCategoryToken>,
    webDomains: Set<WebDomainToken>,
    minutes: Int
  ) -> DeviceActivityEvent {
    let threshold = DateComponents(minute: minutes)
    // Without includesPastActivity a restart at 3pm counts from 3pm, silently treating the morning as zero.
    if #available(iOS 17.4, *) {
      return DeviceActivityEvent(
        applications: applications,
        categories: categories,
        webDomains: webDomains,
        threshold: threshold,
        includesPastActivity: true
      )
    }
    return DeviceActivityEvent(
      applications: applications,
      categories: categories,
      webDomains: webDomains,
      threshold: threshold
    )
  }

  /**
   * `probeMinutes` adds one extra low rung per category, named `<category>.pN` so the research parser
   * skips it. It exists so a tester can confirm the whole chain in a minute instead of five; one minute
   * is the floor, because DeviceActivity thresholds are minute-granular and a sub-minute
   * `DateComponents` is not honoured.
   */
  func startMonitoring(
    thresholdsByCategory: [String: [Int]],
    appThresholds: [Int],
    probeMinutes: Int
  ) throws -> [String] {
    guard authorizationStatus() == "approved" else { return [] }

    var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    var selectionData = Data()
    var pickedApps: [String: ApplicationToken] = [:]

    for category in Self.categories {
      guard let selection = decodeSelection(category) else { continue }
      if let data = SharedStore.selectionData(for: category) { selectionData.append(data) }
      // An empty bucket would register an event that can never fire, which downstream would
      // read as "never used" instead of "never chose any".
      if selection.applicationTokens.isEmpty && selection.categoryTokens.isEmpty { continue }

      for minutes in (thresholdsByCategory[category] ?? []) where minutes > 0 {
        events[DeviceActivityEvent.Name("\(category).\(minutes)")] = Self.event(
          applications: selection.applicationTokens,
          categories: selection.categoryTokens,
          webDomains: selection.webDomainTokens,
          minutes: minutes
        )
      }
      if probeMinutes > 0 {
        events[DeviceActivityEvent.Name("\(category).p\(probeMinutes)")] = Self.event(
          applications: selection.applicationTokens,
          categories: selection.categoryTokens,
          webDomains: selection.webDomainTokens,
          minutes: probeMinutes
        )
      }

      for token in selection.applicationTokens {
        if let id = Self.appId(for: token) { pickedApps[id] = token }
      }
    }
    // Same ordering rule as `trackedApps()`, so the apps the participant is asked to name are
    // exactly the apps that end up with their own event ladder.

    // Only apps picked one by one can be watched on their own: iOS cannot list the apps inside a picked category.
    // Group and probe events are registered first and never dropped, so a tight budget costs per-app
    // detail rather than the categories the study actually reports on.
    for id in pickedApps.keys.sorted().prefix(Self.maxTrackedApps) {
      guard let token = pickedApps[id] else { continue }
      for minutes in appThresholds where minutes > 0 {
        if events.count >= Self.eventBudget { break }
        events[DeviceActivityEvent.Name("app_\(id).\(minutes)")] = Self.event(
          applications: [token],
          categories: [],
          webDomains: [],
          minutes: minutes
        )
      }
    }

    guard !events.isEmpty else {
      stopMonitoring()
      return []
    }
    let names = events.keys.map(\.rawValue).sorted()

    // Restarting resets iOS's running count for the day, so an unchanged plan is left running rather than
    // restarted on every foreground.
    var fingerprintInput = Data(names.joined(separator: ",").utf8)
    fingerprintInput.append(selectionData)
    let fingerprint = SHA256.hash(data: fingerprintInput).map { String(format: "%02x", $0) }.joined()
    if fingerprint == SharedStore.defaults?.string(forKey: SharedStore.Key.monitoringFingerprint),
       center.activities.contains(activityName) {
      return names
    }

    // The interval is one day, so each threshold fires at most once per day and counters reset with it.
    let schedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: 0, minute: 0),
      intervalEnd: DateComponents(hour: 23, minute: 59),
      repeats: true
    )

    center.stopMonitoring([activityName])
    try center.startMonitoring(activityName, during: schedule, events: events)
    SharedStore.defaults?.set(names, forKey: SharedStore.Key.monitoredThresholds)
    SharedStore.defaults?.set(fingerprint, forKey: SharedStore.Key.monitoringFingerprint)
    return names
  }

  /**
   * One call that answers "why is nothing arriving?", because every step in this chain fails soft and
   * looks identical from JS: no entitlement, no authorization, nothing picked, a plan that threw, and a
   * plan that is live but has not been crossed yet all produce zero rows.
   */
  func diagnostics() -> [String: Any] {
    var selections: [String: Any] = [:]
    var anySelection = false
    for category in Self.categories {
      let selection = decodeSelection(category)
      let apps = selection?.applicationTokens.count ?? 0
      let cats = selection?.categoryTokens.count ?? 0
      if apps + cats > 0 { anySelection = true }
      selections[category] = ["applications": apps, "categories": cats]
    }
    let names = monitoredThresholds
    return [
      "appGroupConfigured": SharedStore.appGroupId != nil,
      "authorization": authorizationStatus(),
      "selections": selections,
      "anySelection": anySelection,
      "monitoredEventCount": names.count,
      "monitoredEventNames": names,
      // The source of truth: a plan can be remembered in defaults while iOS is no longer monitoring it.
      "activityRegistered": center.activities.contains(activityName),
      "pendingThresholdEvents": (SharedStore.defaults?.array(forKey: SharedStore.Key.thresholdEvents) as? [[String: Any]] ?? []).count,
      "maxTrackedApps": Self.maxTrackedApps,
      "eventBudget": Self.eventBudget,
    ]
  }

  func stopMonitoring() {
    center.stopMonitoring([activityName])
    SharedStore.defaults?.removeObject(forKey: SharedStore.Key.monitoredThresholds)
    SharedStore.defaults?.removeObject(forKey: SharedStore.Key.monitoringFingerprint)
  }

  var monitoredThresholds: [String] {
    SharedStore.defaults?.stringArray(forKey: SharedStore.Key.monitoredThresholds) ?? []
  }
}

/** An individually picked app: the anonymous id rows are filed under, plus the opaque token iOS renders. */
struct TrackedApp: Identifiable {
  let id: String
  let token: ApplicationToken
}

private final class LabelModel: ObservableObject {
  let apps: [TrackedApp]
  @Published var names: [String: String]

  init(apps: [TrackedApp], names: [String: String]) {
    self.apps = apps
    self.names = names
  }
}

private struct AppLabelView: View {
  @ObservedObject var model: LabelModel
  let onDone: () -> Void
  let onCancel: () -> Void

  var body: some View {
    NavigationView {
      Form {
        Section(
          footer: Text(
            "The icon and title above each box come from iOS and never leave your phone — MoodSense cannot read them. Only the name you type is saved with your data. Leave one blank to keep that app unnamed."
          )
        ) {
          ForEach(model.apps) { app in
            VStack(alignment: .leading, spacing: 8) {
              Label(app.token).labelStyle(.titleAndIcon)
              TextField(
                "Name this app",
                text: Binding(
                  get: { model.names[app.id] ?? "" },
                  set: { model.names[app.id] = $0 }
                )
              )
              .textInputAutocapitalization(.words)
              .autocorrectionDisabled()
            }
            .padding(.vertical, 4)
          }
        }
      }
      .navigationTitle("Name your apps")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
        ToolbarItem(placement: .confirmationAction) { Button("Save", action: onDone) }
      }
    }
  }
}

private final class PickerModel: ObservableObject {
  @Published var selection: FamilyActivitySelection

  init(selection: FamilyActivitySelection) {
    self.selection = selection
  }
}

private struct ActivityPickerView: View {
  @ObservedObject var model: PickerModel
  let title: String
  let headerText: String
  let footerText: String
  let onDone: () -> Void
  let onCancel: () -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(
        headerText: headerText,
        footerText: footerText,
        selection: $model.selection
      )
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", action: onCancel)
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", action: onDone)
          }
        }
    }
  }
}
