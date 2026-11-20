package com.michael.teneo.updates;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

/**
 * signed-android-manifest.json was signed by apps/desktop/scripts/
 * release-manifest.ts with a test key (scripts/release-manifest.test.ts
 * checks the same file), so this checks that the phone reads exactly what
 * the Mac signs.
 */
public class SignedManifestTest {

    private String[] testKeys;
    private JSONObject signed;

    @Before
    public void readFixture() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/signed-android-manifest.json")) {
            JSONObject fixture = new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            testKeys = new String[] { fixture.getString("publicKey") };
            signed = fixture.getJSONObject("manifest");
        }
    }

    private void assertRefused(String text, String[] keys) {
        try {
            SignedManifest.verify(text, keys);
            fail("accepted " + text);
        } catch (SignedManifest.Invalid expected) {
            // refused, as it should be
        }
    }

    @Test
    public void readsAManifestTheMacSigned() throws Exception {
        SignedManifest manifest = SignedManifest.verify(signed.toString(), testKeys);
        assertEquals("0.1.4", manifest.version);
        assertEquals(10499, manifest.versionCode);
        assertEquals("com.michael.teneo", manifest.packageName);
        assertEquals("https://github.com/theCodeD3vil/teneo/releases/download/android-v0.1.4/Teneo-0.1.4.apk", manifest.apkUrl);
        assertEquals(12_345_678, manifest.size);
        assertEquals("ab".repeat(32), manifest.sha256);
    }

    @Test
    public void refusesAKeyTeneoDoesntTrust() {
        assertRefused(signed.toString(), SignedManifest.PUBLIC_KEYS);
        assertRefused(signed.toString(), new String[] {});
        assertRefused(signed.toString(), new String[] { "not base64!" });
    }

    @Test
    public void refusesAnythingChangedAfterSigning() throws Exception {
        JSONObject envelope = signed.getJSONObject("signed");
        String payload = envelope.getString("payload");

        JSONObject changed = new JSONObject(signed.toString());
        changed.getJSONObject("signed").put("payload", payload.replace("12345678", "12345679"));
        assertRefused(changed.toString(), testKeys);

        // a Mac manifest's signature is over another prefix
        JSONObject asMac = new JSONObject(signed.toString());
        asMac.getJSONObject("signed").put("format", "tinyjs-update-v1");
        assertRefused(asMac.toString(), testKeys);

        JSONObject extraField = new JSONObject(signed.toString());
        extraField.getJSONObject("signed").put("note", "x");
        assertRefused(extraField.toString(), testKeys);

        // plain fields beside the envelope are never read: refused outright
        JSONObject plainBeside = new JSONObject(signed.toString());
        plainBeside.put("apk", new JSONObject().put("url", "https://evil.example/x.apk"));
        assertRefused(plainBeside.toString(), testKeys);

        JSONObject paddedSignature = new JSONObject(signed.toString());
        paddedSignature.getJSONObject("signed").put("signature", envelope.getString("signature") + "=");
        assertRefused(paddedSignature.toString(), testKeys);

        assertRefused("{}", testKeys);
        assertRefused("not json", testKeys);
        assertRefused(new JSONObject(payload).toString(), testKeys); // unsigned, as CI writes it
    }

    @Test
    public void acceptsOnlyAReleaseOfThisApp() throws Exception {
        SignedManifest manifest = SignedManifest.verify(signed.toString(), testKeys);
        assertNull(UpdateRules.manifestProblem(manifest, "com.michael.teneo"));
        assertEquals(
            "The signed update is for a different app",
            UpdateRules.manifestProblem(manifest, "com.michael.teneo.beta")
        );
    }

    @Test
    public void eachAppUpdatesFromItsOwnFileInTheChannel() {
        assertEquals(
            "https://github.com/theCodeD3vil/teneo/releases/download/beta-channel/android-manifest.json",
            UpdateRules.channelUrl("com.michael.teneo")
        );
        assertEquals(
            "https://github.com/theCodeD3vil/teneo/releases/download/beta-channel/android-beta-manifest.json",
            UpdateRules.channelUrl("com.michael.teneo.beta")
        );
    }
}
