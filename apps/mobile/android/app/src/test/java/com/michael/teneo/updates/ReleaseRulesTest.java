package com.michael.teneo.updates;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class ReleaseRulesTest {

    private static String tag(String version) {
        return "refs/tags/android-v" + version;
    }

    @Test
    public void aVersionCodeIsTheOneTheBuildGives() {
        assertEquals(1020304, ReleaseRules.versionCode("1.2.3-beta.4"));
        assertEquals(1020399, ReleaseRules.versionCode("1.2.3"));
        assertEquals(10005, ReleaseRules.versionCode("0.1.0-beta.5"));
    }

    @Test
    public void whatIsNotAReleaseVersionHasNoCode() {
        assertEquals(-1, ReleaseRules.versionCode(null));
        assertEquals(-1, ReleaseRules.versionCode(""));
        assertEquals(-1, ReleaseRules.versionCode("1.2"));
        assertEquals(-1, ReleaseRules.versionCode("1.2.300"));
        assertEquals(-1, ReleaseRules.versionCode("1.2.3-beta.0"));
        assertEquals(-1, ReleaseRules.versionCode("1.2.3-beta.99"));
        assertEquals(-1, ReleaseRules.versionCode("1.2.3-rc.1"));
    }

    @Test
    public void onlyNewerVersionsAreCandidatesNewestFirst() {
        assertEquals(
            Arrays.asList("0.1.0-beta.10", "0.1.0-beta.6"),
            ReleaseRules.candidates(
                "0.1.0-beta.5",
                Arrays.asList(tag("0.1.0-beta.4"), tag("0.1.0-beta.6"), tag("0.1.0-beta.5"), tag("0.1.0-beta.10"))
            )
        );
    }

    @Test
    public void aBetaIsOfferedOnlyBetasAndAFullReleaseOnlyFullReleases() {
        assertEquals(
            Collections.singletonList("0.2.0-beta.1"),
            ReleaseRules.candidates("0.1.0-beta.5", Arrays.asList(tag("0.1.0"), tag("0.2.0-beta.1")))
        );
        assertEquals(Collections.singletonList("0.2.0"), ReleaseRules.candidates("0.1.0", Arrays.asList(tag("0.2.0"), tag("0.3.0-beta.1"))));
    }

    @Test
    public void otherTagsAndABuildWithNoVersionGiveNoCandidates() {
        assertTrue(ReleaseRules.candidates("0.1.0", Arrays.asList("refs/tags/v0.9.0", tag("nonsense"), null)).isEmpty());
        assertTrue(ReleaseRules.candidates("dev", Collections.singletonList(tag("0.2.0"))).isEmpty());
    }

    @Test
    public void onlyAFewCandidatesAreLookedAt() {
        assertEquals(
            Arrays.asList("0.1.4", "0.1.3", "0.1.2"),
            ReleaseRules.candidates("0.1.0", Arrays.asList(tag("0.1.1"), tag("0.1.2"), tag("0.1.3"), tag("0.1.4")))
        );
    }

    @Test
    public void theNextPageIsFollowedOnlyOnGitHubsApi() {
        String next = ReleaseRules.API + "/git/matching-refs/tags/android-v?page=2";
        assertEquals(next, ReleaseRules.nextPage("<" + next + ">; rel=\"next\", <" + next + ">; rel=\"last\""));
        assertNull(ReleaseRules.nextPage("<https://example.com/page2>; rel=\"next\""));
        assertNull(ReleaseRules.nextPage("<" + next + ">; rel=\"last\""));
        assertNull(ReleaseRules.nextPage(null));
    }

    @Test
    public void theApkIsTheReleasesOwnAsset() {
        String url = "https://github.com/theCodeD3vil/teneo/releases/download/android-v0.2.0/Teneo-0.2.0.apk";
        assertTrue(ReleaseRules.isApk("0.2.0", "Teneo-0.2.0.apk", url, 10));
        assertFalse(ReleaseRules.isApk("0.2.0", "notes.txt", url, 10));
        assertFalse(ReleaseRules.isApk("0.2.0", "Teneo-0.2.0.apk", "https://example.com/Teneo-0.2.0.apk", 10));
        assertFalse(ReleaseRules.isApk("0.3.0", "Teneo-0.2.0.apk", url, 10));
        assertFalse(ReleaseRules.isApk("0.2.0", "Teneo-0.2.0.apk", url, 0));
    }
}
