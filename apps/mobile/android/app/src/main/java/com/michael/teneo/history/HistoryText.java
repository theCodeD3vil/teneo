package com.michael.teneo.history;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The parts of listing the history that don't touch the database: cutting a
 * long text down for the list and matching a search. Ports of
 * apps/desktop/backend/history-query.ts, so the phone lists as the Mac does.
 */
public final class HistoryText {

    /** textPreviewLength in @teneo/shared: how much of a text the list carries */
    public static final int PREVIEW_LENGTH = 1000;

    private HistoryText() {}

    public static final class Preview {

        public final String text;
        public final List<SecretSpan> secrets;
        public final boolean isTruncated;

        Preview(String text, List<SecretSpan> secrets, boolean isTruncated) {
            this.text = text;
            this.secrets = secrets;
            this.isTruncated = isTruncated;
        }
    }

    /**
     * The start of a long text for the list, with the secrets that fit in it. A
     * secret the cut would split is left out whole: a half-shown key would be
     * masked with the wrong tail. `fullLength` is the length of the whole text
     * when `text` is already only its start.
     */
    public static Preview truncate(String text, List<SecretSpan> secrets, int fullLength, int limit) {
        if (fullLength <= limit && text.length() <= limit) return new Preview(text, secrets, false);
        int cut = Math.min(limit, text.length());
        // never half a surrogate pair: the list would show a broken character
        if (cut > 0 && cut < text.length() && Character.isHighSurrogate(text.charAt(cut - 1))) cut -= 1;
        for (SecretSpan secret : secrets) {
            if (secret.start < cut && secret.end > cut) cut = secret.start;
        }
        List<SecretSpan> kept = new ArrayList<>();
        for (SecretSpan secret : secrets) {
            if (secret.end <= cut) kept.add(secret);
        }
        return new Preview(text.substring(0, cut), kept, true);
    }

    /** A LIKE pattern that finds `search` anywhere, with its own wildcards escaped by \ */
    public static String likePattern(String search) {
        return "%" + search.toLowerCase(Locale.ROOT).replaceAll("[\\\\%_]", "\\\\$0") + "%";
    }

    /** As the app shows a hidden secret: a long one keeps its last 4 characters */
    public static String maskSecret(String secret) {
        return "********" + (secret.length() >= 20 ? secret.substring(secret.length() - 4) : "");
    }

    /**
     * Whether an item holding secrets matches `search` (already lower-cased).
     * With secrets hidden, a secret is found by what the card shows and by its
     * label, so searching for part of a key can't reveal which item holds it.
     * The label is found either way.
     */
    public static boolean matchesSearch(
        String text,
        List<SecretSpan> secrets,
        String sourceAppName,
        String linkHost,
        String search,
        boolean hideSecrets
    ) {
        if (contains(searchableText(text, secrets, hideSecrets), search)) return true;
        for (SecretSpan secret : secrets) {
            if (contains(secret.label, search)) return true;
        }
        return contains(sourceAppName, search) || contains(linkHost, search);
    }

    static String searchableText(String text, List<SecretSpan> secrets, boolean hideSecrets) {
        if (text == null || !hideSecrets || secrets.isEmpty()) return text;
        StringBuilder parts = new StringBuilder();
        int position = 0;
        for (SecretSpan secret : secrets) {
            if (secret.start < position || secret.end > text.length() || secret.start > secret.end) continue;
            parts.append(text, position, secret.start);
            parts.append(maskSecret(text.substring(secret.start, secret.end))).append(' ').append(secret.label).append(' ');
            position = secret.end;
        }
        parts.append(text.substring(position));
        return parts.toString();
    }

    private static boolean contains(String value, String search) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(search);
    }
}
