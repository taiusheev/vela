import SwiftUI
import WidgetKit

/// Shared with the app through the App Group (`src/device/widget.ts`).
private let appGroup = "group.family.vela.light.shared"
private let snapshotKey = "lights"

struct WidgetLight: Codable, Hashable {
  let name: String
  let lit: Bool
  let line: String
  let date: String
  let tz: String
}

struct WidgetSnapshot: Codable {
  let lights: [WidgetLight]
  let waiting: String
  let at: String
}

struct LightsEntry: TimelineEntry {
  let date: Date
  let lights: [WidgetLight]
}

/// Her local day as the app writes it, "2026-11-02".
private func localDay(_ date: Date, _ tz: String) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: tz) ?? .current
  let parts = calendar.dateComponents([.year, .month, .day], from: date)
  return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

/// The next midnight where she lives, when yesterday's light must stop showing as today's.
private func nextMidnight(after date: Date, _ tz: String) -> Date {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: tz) ?? .current
  let start = calendar.startOfDay(for: date)
  return calendar.date(byAdding: .day, value: 1, to: start) ?? date.addingTimeInterval(86_400)
}

/// The lights as of `date`: a light from an earlier day of hers reads as waiting, never lit.
private func lights(at date: Date, from snapshot: WidgetSnapshot?) -> [WidgetLight] {
  guard let snapshot else { return [] }
  return snapshot.lights.map { light in
    light.date == localDay(date, light.tz)
      ? light
      : WidgetLight(name: light.name, lit: false, line: snapshot.waiting, date: light.date, tz: light.tz)
  }
}

private func readSnapshot() -> WidgetSnapshot? {
  guard
    let raw = UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey),
    let data = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> LightsEntry {
    LightsEntry(date: Date(), lights: [WidgetLight(name: "Mom", lit: true, line: "8:12", date: "", tz: "UTC")])
  }

  func getSnapshot(in context: Context, completion: @escaping (LightsEntry) -> Void) {
    let snapshot = readSnapshot()
    completion(snapshot == nil && context.isPreview ? placeholder(in: context) : LightsEntry(date: Date(), lights: lights(at: Date(), from: snapshot)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LightsEntry>) -> Void) {
    let now = Date()
    let snapshot = readSnapshot()
    var entries = [LightsEntry(date: now, lights: lights(at: now, from: snapshot))]
    // One more picture at each parent's next midnight, so the window goes back to waiting.
    let midnights = Set((snapshot?.lights ?? []).map { nextMidnight(after: now, $0.tz) }).sorted()
    for midnight in midnights {
      entries.append(LightsEntry(date: midnight, lights: lights(at: midnight, from: snapshot)))
    }
    completion(Timeline(entries: entries, policy: .after(midnights.last ?? now.addingTimeInterval(6 * 3600))))
  }
}

/// The window: amber when lit, a quiet outline when not.
struct WindowMark: View {
  let lit: Bool
  var body: some View {
    RoundedRectangle(cornerRadius: 4, style: .continuous)
      .fill(lit ? Color("$accent") : Color.secondary.opacity(0.18))
      .overlay(
        RoundedRectangle(cornerRadius: 4, style: .continuous)
          .strokeBorder(lit ? Color("$accent") : Color.secondary.opacity(0.5), lineWidth: 1.5)
      )
      .shadow(color: lit ? Color("$accent").opacity(0.6) : .clear, radius: 6)
      .frame(width: 22, height: 30)
      .accessibilityHidden(true)
  }
}

struct LightRow: View {
  let light: WidgetLight
  var body: some View {
    HStack(spacing: 10) {
      WindowMark(lit: light.lit)
      VStack(alignment: .leading, spacing: 2) {
        Text(light.name).font(.headline).lineLimit(1)
        Text(light.line).font(.caption).foregroundStyle(.secondary).lineLimit(2)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

struct VelaWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: LightsEntry

  var body: some View {
    switch family {
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: entry.lights.first?.lit == true ? "window.vertical.open" : "window.vertical.closed")
          .font(.title3)
      }
      .widgetAccentable()
    case .accessoryRectangular, .accessoryInline:
      if let light = entry.lights.first {
        VStack(alignment: .leading) {
          Text(light.name).font(.headline).widgetAccentable()
          Text(light.line).font(.caption).lineLimit(2)
        }
      } else {
        Text("Vela Light")
      }
    default:
      if entry.lights.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          WindowMark(lit: false)
          Text("Vela Light").font(.headline)
        }
      } else {
        VStack(alignment: .leading, spacing: 12) {
          ForEach(entry.lights.prefix(family == .systemSmall ? 1 : 2), id: \.self) { light in
            LightRow(light: light)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
}

@main
struct VelaWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "VelaWidget", provider: Provider()) { entry in
      VelaWidgetView(entry: entry)
        .containerBackground(Color("$widgetBackground"), for: .widget)
        .widgetURL(URL(string: "velalight://"))
    }
    .configurationDisplayName("Vela Light")
    .description("Your parent's window, lit when they answer.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
  }
}
