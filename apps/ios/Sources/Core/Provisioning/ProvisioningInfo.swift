import Foundation

/// Reads the expiry date out of the app's embedded provisioning profile.
///
/// Why this exists: with a free Apple ID the signing certificate lasts 7 days.
/// When it lapses the app simply stops launching — and if that app is a pet
/// camera sitting on a shelf, you find out by noticing the stream has been dead
/// for a day. Surfacing the countdown in the viewer's status bar turns a silent
/// failure into a visible one.
///
/// Returns nil for builds installed from TestFlight or the App Store, which
/// carry no embedded profile and do not expire this way.
enum ProvisioningInfo {

    static var expiryDate: Date? {
        guard let url = Bundle.main.url(
            forResource: "embedded", withExtension: "mobileprovision"
        ), let data = try? Data(contentsOf: url) else {
            return nil
        }
        guard let plist = extractPlist(from: data) else { return nil }
        return plist["ExpirationDate"] as? Date
    }

    static var daysRemaining: Int? {
        guard let expiry = expiryDate else { return nil }
        return Calendar.current.dateComponents(
            [.day], from: Date(), to: expiry
        ).day
    }

    /// ISO-8601 form for the wire protocol (`CameraState.provisioningExpiresAt`).
    static var expiryISO8601: String? {
        guard let expiry = expiryDate else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: expiry)
    }

    /// A .mobileprovision is a CMS (PKCS#7) envelope with an XML plist payload.
    /// Rather than link Security.framework just to unwrap it, we locate the
    /// plist by its delimiters — the payload is plain text inside the blob.
    private static func extractPlist(from data: Data) -> [String: Any]? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(
                of: Data("</plist>".utf8),
                options: [],
                in: start.lowerBound..<data.endIndex
              )
        else { return nil }

        let payload = data[start.lowerBound..<end.upperBound]
        return try? PropertyListSerialization.propertyList(
            from: payload, options: [], format: nil
        ) as? [String: Any]
    }
}
