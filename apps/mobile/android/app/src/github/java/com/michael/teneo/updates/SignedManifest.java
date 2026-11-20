package com.michael.teneo.updates;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Iterator;
import java.util.TreeSet;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * android-manifest.json, the file each Android release carries that names
 * its APK: version, app, size and SHA-256, signed with Teneo's update key on
 * the maintainer's Mac (apps/desktop/scripts/release-manifest.ts makes and
 * signs it). The phone downloads only an APK a signed manifest names, so a
 * release made with a stolen GitHub login, without that key, installs
 * nowhere.
 */
final class SignedManifest {

    static final String FILE = "android-manifest.json";
    static final String FORMAT = "teneo-android-update-v1";
    /**
     * apps/desktop/tinyjs.json's update.publicKey: the one key that signs
     * Teneo's updates, Mac and Android. src/updates/signing-keys.test.ts keeps
     * the two lists the same.
     */
    static final String[] PUBLIC_KEYS = { "naf53IW61Z0Tc5/FR7U5H8XJEYP+voY5DsWKVT/dhsA=", "JeLg12A70a3hCUIHUA3IwYDXBm9zYt6fAPAxkCV1u6A=" };
    /** Far above a manifest's size: a longer download is not one */
    static final int MAX_BYTES = 16 * 1024;

    static final String NOT_SIGNED = "This update isn't signed by Teneo";
    private static final int TIMEOUT_MS = 15_000;

    final String version;
    final long versionCode;
    final String packageName;
    final String apkUrl;
    final long size;
    final String sha256;

    private SignedManifest(String version, long versionCode, String packageName, String apkUrl, long size, String sha256) {
        this.version = version;
        this.versionCode = versionCode;
        this.packageName = packageName;
        this.apkUrl = apkUrl;
        this.size = size;
        this.sha256 = sha256;
    }

    /** Why a manifest is refused, to show the user */
    static final class Invalid extends Exception {

        Invalid(String message) {
            super(message);
        }
    }

    /**
     * Downloads the manifest of the release of `version` and returns it once
     * it is signed and is an update for this app (`packageName`, newer than
     * `installedVersionCode`). `opened` is handed the connection, to cancel it.
     */
    static SignedManifest fetch(
        String url,
        String version,
        String packageName,
        long installedVersionCode,
        Consumer<HttpURLConnection> opened
    ) throws IOException, Invalid {
        if (!UpdateRules.isManifestUrl(url, version)) throw new Invalid("That isn't a Teneo release");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        if (opened != null) opened.accept(connection);
        String text;
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            // GitHub sends release files from its storage host, over HTTPS too
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "Teneo-Android");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("GitHub answered " + status);
            if (!"https".equals(connection.getURL().getProtocol())) throw new IOException("GitHub answered over an insecure connection");
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (body.size() + read > MAX_BYTES) throw new Invalid(NOT_SIGNED);
                    body.write(buffer, 0, read);
                }
            }
            text = new String(body.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            connection.disconnect();
        }
        SignedManifest manifest = verify(text, PUBLIC_KEYS);
        String problem = UpdateRules.manifestProblem(manifest, version, packageName, installedVersionCode);
        if (problem != null) throw new Invalid(problem);
        return manifest;
    }

    /** The manifest's contents, once a signature by one of `publicKeys` checks out */
    static SignedManifest verify(String text, String[] publicKeys) throws Invalid {
        JSONObject envelope;
        try {
            JSONObject doc = new JSONObject(text);
            if (!hasKeys(doc, "signed")) throw new Invalid(NOT_SIGNED);
            envelope = doc.getJSONObject("signed");
        } catch (JSONException | RuntimeException error) {
            throw new Invalid(NOT_SIGNED);
        }
        if (
            !hasKeys(envelope, "algorithm", "format", "payload", "signature") ||
            !FORMAT.equals(envelope.opt("format")) ||
            !"Ed25519".equals(envelope.opt("algorithm")) ||
            !(envelope.opt("payload") instanceof String) ||
            !(envelope.opt("signature") instanceof String)
        ) {
            throw new Invalid(NOT_SIGNED);
        }
        String payload = (String) envelope.opt("payload");
        byte[] signature = strictBase64((String) envelope.opt("signature"), 64);
        if (signature == null) throw new Invalid(NOT_SIGNED);
        byte[] message = (FORMAT + "\n" + payload).getBytes(StandardCharsets.UTF_8);
        for (String key : publicKeys) {
            byte[] raw = strictBase64(key, 32);
            if (raw != null && Ed25519.verify(raw, message, signature)) return parse(payload);
        }
        throw new Invalid(NOT_SIGNED);
    }

    private static SignedManifest parse(String payload) throws Invalid {
        try {
            JSONObject doc = new JSONObject(payload);
            JSONObject apk = doc.optJSONObject("apk");
            if (!hasKeys(doc, "apk", "package", "version", "versionCode") || apk == null || !hasKeys(apk, "sha256", "size", "url")) {
                throw new Invalid("The signed update is malformed");
            }
            Object version = doc.opt("version");
            Object packageName = doc.opt("package");
            Object url = apk.opt("url");
            Object sha256 = apk.opt("sha256");
            long versionCode = UpdateRules.wholeNumber(doc.opt("versionCode"));
            long size = UpdateRules.wholeNumber(apk.opt("size"));
            if (!(version instanceof String) || !(packageName instanceof String) || !(url instanceof String) || !(sha256 instanceof String)) {
                throw new Invalid("The signed update is malformed");
            }
            return new SignedManifest((String) version, versionCode, (String) packageName, (String) url, size, (String) sha256);
        } catch (JSONException error) {
            throw new Invalid("The signed update is malformed");
        }
    }

    /** Whether the object has exactly these keys */
    private static boolean hasKeys(JSONObject object, String... names) {
        TreeSet<String> found = new TreeSet<>();
        for (Iterator<String> keys = object.keys(); keys.hasNext();) found.add(keys.next());
        TreeSet<String> wanted = new TreeSet<>();
        java.util.Collections.addAll(wanted, names);
        return found.equals(wanted);
    }

    /** The bytes of canonical base64 text of exactly `length` bytes, or null */
    static byte[] strictBase64(String text, int length) {
        if (text == null) return null;
        try {
            byte[] bytes = Base64.getDecoder().decode(text);
            return bytes.length == length && Base64.getEncoder().encodeToString(bytes).equals(text) ? bytes : null;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }
}
