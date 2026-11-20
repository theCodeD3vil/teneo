package com.michael.teneo.updates;

import android.content.pm.PackageInstaller;
import java.net.URI;
import java.net.URISyntaxException;

/** The checks an update passes before Android's installer sees it */
final class UpdateRules {

    /** Releases of the Android app (release-android.yml): nothing else is downloaded */
    static final String RELEASE_DOWNLOADS = "https://github.com/theCodeD3vil/teneo/releases/download/android-v";

    /** Far above the app's size: a listing that says more is not to be believed */
    static final long MAX_SIZE = 200L * 1024 * 1024;

    private UpdateRules() {}

    /** An APK of an Android release on GitHub */
    static boolean isReleaseUrl(String url) {
        if (url == null || !url.startsWith(RELEASE_DOWNLOADS) || !url.endsWith(".apk")) return false;
        try {
            URI uri = new URI(url);
            // the prefix pins the scheme and host; the rest must be a plain path
            return uri.getRawQuery() == null
                && uri.getRawFragment() == null
                && uri.getRawUserInfo() == null
                && uri.getPort() == -1
                && !uri.getRawPath().contains("..")
                && !uri.getRawPath().contains("%");
        } catch (URISyntaxException error) {
            return false;
        }
    }

    /** A whole number from the page, or -1: the bridge hands small numbers over as Integer */
    static long wholeNumber(Object value) {
        if (value instanceof Integer || value instanceof Long) return ((Number) value).longValue();
        if (value instanceof Double) {
            double number = (Double) value;
            if (number == Math.rint(number) && number >= 0 && number <= Long.MAX_VALUE) return (long) number;
        }
        return -1;
    }

    /** A SHA-256 as 64 lowercase hex digits. Every update has one: an APK
     *  whose hash nobody vouched for is not downloaded */
    static boolean isDigest(String sha256) {
        return sha256 != null && sha256.matches("[0-9a-f]{64}");
    }

    /** The signed manifest of the Android release of `version` on GitHub */
    static boolean isManifestUrl(String url, String version) {
        return ReleaseRules.versionCode(version) > 0 && (RELEASE_DOWNLOADS + version + "/" + SignedManifest.FILE).equals(url);
    }

    /**
     * What is wrong with a signed manifest, or null when it is an update for
     * this app: the version the release is tagged with, an APK of that
     * release with a size and hash, newer than the one installed.
     */
    static String manifestProblem(SignedManifest manifest, String expectedVersion, String packageName, long installedVersionCode) {
        if (!manifest.version.equals(expectedVersion)) return "The signed update is for another version";
        if (manifest.versionCode != ReleaseRules.versionCode(manifest.version)) return "The signed update is malformed";
        if (!manifest.packageName.equals(packageName)) return "The signed update is for a different app";
        if (manifest.versionCode <= installedVersionCode) return "This version of Teneo is already installed";
        if (!isReleaseUrl(manifest.apkUrl) || !manifest.apkUrl.startsWith(RELEASE_DOWNLOADS + manifest.version + "/")) {
            return "The signed update names a file Teneo won't download";
        }
        if (manifest.size <= 0 || manifest.size > MAX_SIZE || !isDigest(manifest.sha256)) return "The signed update is malformed";
        return null;
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) text.append(String.format("%02x", b & 0xff));
        return text.toString();
    }

    /**
     * What is wrong with a downloaded APK, or null when it is the release
     * asked for: this app, at the version the release named, newer than the
     * one installed. Android checks the signature itself.
     */
    static String archiveProblem(
        String packageName,
        long versionCode,
        String expectedPackage,
        long expectedVersionCode,
        long installedVersionCode
    ) {
        if (packageName == null) return "The download isn't an app Android can read";
        if (!packageName.equals(expectedPackage)) return "The download is a different app";
        if (versionCode != expectedVersionCode) return "The download isn't the version the release named";
        if (versionCode <= installedVersionCode) return "This version of Teneo is already installed";
        return null;
    }

    /** What to tell the user when Android's installer fails */
    static String installFailure(int status) {
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "Android blocked the update";
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                return "Android won't install it over this Teneo, which may be signed differently";
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "This update doesn't work on this phone";
            case PackageInstaller.STATUS_FAILURE_INVALID:
                return "The update file is damaged";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "There isn't enough space for the update";
            default:
                return "The update couldn't be installed";
        }
    }
}
