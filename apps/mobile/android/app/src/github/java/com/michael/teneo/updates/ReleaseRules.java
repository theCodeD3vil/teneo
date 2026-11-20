package com.michael.teneo.updates;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which release is an update, for the check that runs without the app open
 * (UpdateCheckJob). The same rules as the app's own check, in
 * src/updates/releases.ts and versions.ts: keep the two in step.
 */
final class ReleaseRules {

    static final String API = "https://api.github.com/repos/theCodeD3vil/teneo";
    static final String TAG_PREFIX = "android-v";
    /** 600 tags: far more Android releases than there will be for years */
    static final int MAX_TAG_PAGES = 20;
    /** A tag whose release failed or is still a draft is passed over, a few times */
    static final int MAX_CANDIDATES = 3;

    private static final String REF_PREFIX = "refs/tags/" + TAG_PREFIX;
    // as release-android.yml allows: 1.2.3 or 1.2.3-beta.4
    private static final Pattern VERSION = Pattern.compile("^(\\d{1,4})\\.(\\d{1,2})\\.(\\d{1,2})(?:-beta\\.([1-9]\\d?))?$");
    private static final Pattern NEXT_PAGE = Pattern.compile("<([^>]+)>\\s*;\\s*rel=\"next\"");

    private ReleaseRules() {}

    /**
     * The version code android/app/build.gradle gives a version, which is
     * what "newer" means to Android, or -1 for what isn't a release's version.
     */
    static long versionCode(String version) {
        Matcher match = version == null ? null : VERSION.matcher(version);
        if (match == null || !match.matches()) return -1;
        long beta = match.group(4) == null ? 99 : Long.parseLong(match.group(4));
        if (match.group(4) != null && beta == 99) return -1;
        return Long.parseLong(match.group(1)) * 1_000_000 + Long.parseLong(match.group(2)) * 10_000 + Long.parseLong(match.group(3)) * 100 + beta;
    }

    static boolean isBeta(String version) {
        return version.contains("-beta.");
    }

    /**
     * The versions among the tags that could update `installed`, newest
     * first. A beta is offered only betas and a full release only full
     * releases: they are two apps, and Android won't update one with the other.
     */
    static List<String> candidates(String installed, List<String> refs) {
        List<String> newer = new ArrayList<>();
        long installedCode = versionCode(installed);
        if (installedCode < 0) return newer;
        for (String ref : refs) {
            if (ref == null || !ref.startsWith(REF_PREFIX)) continue;
            String version = ref.substring(REF_PREFIX.length());
            if (versionCode(version) > installedCode && isBeta(version) == isBeta(installed)) newer.add(version);
        }
        newer.sort((a, b) -> Long.compare(versionCode(b), versionCode(a)));
        return newer.size() > MAX_CANDIDATES ? new ArrayList<>(newer.subList(0, MAX_CANDIDATES)) : newer;
    }

    /** The next page of tags from GitHub's Link header, and only GitHub's own API */
    static String nextPage(String link) {
        Matcher match = link == null ? null : NEXT_PAGE.matcher(link);
        if (match == null || !match.find()) return null;
        return match.group(1).startsWith(API + "/") ? match.group(1) : null;
    }

    /** Whether a release's asset is the APK of that version */
    static boolean isApk(String version, String name, String url, long size) {
        return (
            name != null &&
            name.endsWith(".apk") &&
            url != null &&
            url.startsWith(UpdateRules.RELEASE_DOWNLOADS + version + "/") &&
            size > 0
        );
    }
}
