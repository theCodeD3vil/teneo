import CryptoKit
import Foundation
import LocalAuthentication
import Security

// Only the signed backend should invoke this helper. Requests, including the
// opaque Secure Enclave representation, travel over stdin instead of argv.
private struct Request: Decodable {
    let operation: String
    let representation: Data?
    let message: Data?
    let envelope: HistoryEnvelope?
    let requireAuthentication: Bool?
    let allowInteraction: Bool?
}

private struct Response: Encodable {
    let publicKey: Data?
    let representation: Data?
    let signature: Data?
    var envelope: HistoryEnvelope? = nil
    var key: Data? = nil
}

private struct HistoryEnvelope: Codable {
    let representation: Data
    let ephemeral: Data
    let sealed: Data
    let requireAuthentication: Bool
}

private enum IdentityError: Error {
    case unsupported
    case malformed
}

private func historyContext(_ requiresAuthentication: Bool) -> Data {
    Data("teneo history key wrap v1 \(requiresAuthentication ? "presence" : "automatic")".utf8)
}

private func wrappingKey(_ secret: SharedSecret, _ context: Data) -> SymmetricKey {
    secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(), sharedInfo: context, outputByteCount: 32)
}

private func run(_ request: Request) throws -> Response {
    guard SecureEnclave.isAvailable else { throw IdentityError.unsupported }

    switch request.operation {
    case "available":
        return Response(publicKey: nil, representation: nil, signature: nil)
    case "protect-history":
        guard let key = request.message, key.count == 32,
              let requiresAuthentication = request.requireAuthentication else { throw IdentityError.malformed }
        let flags: SecAccessControlCreateFlags = requiresAuthentication
            ? [.privateKeyUsage, .userPresence] : [.privateKeyUsage]
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, flags, nil
        ) else { throw IdentityError.unsupported }
        let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
        let ephemeral = P256.KeyAgreement.PrivateKey()
        let secret = try ephemeral.sharedSecretFromKeyAgreement(with: enclave.publicKey)
        let context = historyContext(requiresAuthentication)
        let sealed = try AES.GCM.seal(key, using: wrappingKey(secret, context), authenticating: context)
        guard let combined = sealed.combined else { throw IdentityError.malformed }
        return Response(publicKey: nil, representation: nil, signature: nil, envelope: HistoryEnvelope(
            representation: enclave.dataRepresentation, ephemeral: ephemeral.publicKey.x963Representation,
            sealed: combined, requireAuthentication: requiresAuthentication
        ))
    case "open-history":
        guard let envelope = request.envelope, envelope.representation.count <= 4096,
              envelope.ephemeral.count == 65, envelope.sealed.count == 60,
              !envelope.requireAuthentication || request.allowInteraction == true else { throw IdentityError.malformed }
        let authentication = LAContext()
        authentication.interactionNotAllowed = request.allowInteraction != true
        authentication.localizedReason = "Unlock encrypted secrets in Teneo"
        defer { authentication.invalidate() }
        let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(
            dataRepresentation: envelope.representation, authenticationContext: authentication
        )
        let publicKey = try P256.KeyAgreement.PublicKey(x963Representation: envelope.ephemeral)
        let secret = try enclave.sharedSecretFromKeyAgreement(with: publicKey)
        let context = historyContext(envelope.requireAuthentication)
        let sealed = try AES.GCM.SealedBox(combined: envelope.sealed)
        let key = try AES.GCM.open(sealed, using: wrappingKey(secret, context), authenticating: context)
        return Response(publicKey: nil, representation: nil, signature: nil, key: key)
    case "create":
        // The key must work for background sync, so don't require Touch ID.
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, nil
        ) else { throw IdentityError.unsupported }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
        return Response(publicKey: key.publicKey.x963Representation,
                        representation: key.dataRepresentation, signature: nil)
    case "public", "sign":
        guard let representation = request.representation, representation.count <= 4096 else {
            throw IdentityError.malformed
        }
        let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: representation)
        if request.operation == "public" {
            return Response(publicKey: key.publicKey.x963Representation,
                            representation: nil, signature: nil)
        }
        guard let message = request.message, !message.isEmpty, message.count <= 16_384 else {
            throw IdentityError.malformed
        }
        return Response(publicKey: nil, representation: nil,
                        signature: try key.signature(for: message).rawRepresentation)
    default:
        throw IdentityError.malformed
    }
}

do {
    var requestBytes = Data()
    let input = FileHandle.standardInput
    while let chunk = try input.read(upToCount: 4096), !chunk.isEmpty {
        requestBytes.append(chunk)
        guard requestBytes.count <= 32_768 else { throw IdentityError.malformed }
    }
    let request = try JSONDecoder().decode(Request.self, from: requestBytes)
    try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(run(request)))
} catch {
    // Never include the request, the key representation, or the signed bytes.
    exit(1)
}
