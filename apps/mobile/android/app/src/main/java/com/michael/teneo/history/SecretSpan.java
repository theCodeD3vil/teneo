package com.michael.teneo.history;

/** Where a secret sits in an item's text: text.substring(start, end) */
public final class SecretSpan {

    public final int start;
    public final int end;
    /** What kind of secret it is, such as "GitHub token" */
    public final String label;

    public SecretSpan(int start, int end, String label) {
        this.start = start;
        this.end = end;
        this.label = label;
    }
}
