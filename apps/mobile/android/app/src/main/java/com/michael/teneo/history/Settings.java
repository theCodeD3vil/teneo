package com.michael.teneo.history;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The phone's settings as stored: each one's type, and the defaults of the
 * ones native code reads before the app has ever saved them. The app's own
 * defaults are in src/types/settings.ts, and it saves them on its first start.
 */
public final class Settings {

    public enum Type {
        BOOLEAN,
        /** a whole number, 0 or more */
        COUNT,
    }

    public static final String CAPTURE_ON_OPEN = "captureOnOpen";
    public static final String HISTORY_RETENTION_DAYS = "historyRetentionDays";
    public static final String MAX_ITEMS = "maxItems";
    public static final String HIDE_SECRETS = "hideSecrets";

    public static final boolean DEFAULT_CAPTURE_ON_OPEN = false;
    public static final long DEFAULT_HISTORY_RETENTION_DAYS = 30;
    public static final long DEFAULT_MAX_ITEMS = 500;
    public static final boolean DEFAULT_HIDE_SECRETS = true;

    private static final long MAX_COUNT = 1_000_000_000L;

    public static final Map<String, Type> TYPES;

    static {
        Map<String, Type> types = new LinkedHashMap<>();
        types.put("backgroundReceive", Type.BOOLEAN);
        types.put("syncSecrets", Type.BOOLEAN);
        types.put(CAPTURE_ON_OPEN, Type.BOOLEAN);
        types.put(HISTORY_RETENTION_DAYS, Type.COUNT);
        types.put(MAX_ITEMS, Type.COUNT);
        types.put(HIDE_SECRETS, Type.BOOLEAN);
        // read by the app only
        types.put("checkForUpdates", Type.BOOLEAN);
        types.put("showLinkPreviews", Type.BOOLEAN);
        TYPES = Collections.unmodifiableMap(types);
    }

    private Settings() {}

    /** The known settings among `values` that have the right type; a count as a Long */
    public static Map<String, Object> sanitize(Map<String, ?> values) {
        Map<String, Object> clean = new LinkedHashMap<>();
        for (Map.Entry<String, ?> entry : values.entrySet()) {
            Type type = TYPES.get(entry.getKey());
            Object value = entry.getValue();
            if (type == Type.BOOLEAN && value instanceof Boolean) {
                clean.put(entry.getKey(), value);
            } else if (type == Type.COUNT && value instanceof Number number) {
                double count = number.doubleValue();
                if (Double.isFinite(count) && count >= 0 && count <= MAX_COUNT && count == Math.floor(count)) {
                    clean.put(entry.getKey(), (long) count);
                }
            }
        }
        return clean;
    }

    /** A sanitized setting as stored */
    public static String format(Object value) {
        return String.valueOf(value);
    }

    /** A stored setting back as its type, or null if it isn't one */
    public static Object parse(String key, String stored) {
        Type type = TYPES.get(key);
        if (type == null || stored == null) return null;
        if (type == Type.BOOLEAN) {
            if (stored.equals("true")) return true;
            if (stored.equals("false")) return false;
            return null;
        }
        try {
            long count = Long.parseLong(stored);
            return count >= 0 && count <= MAX_COUNT ? count : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    public static boolean bool(Map<String, Object> settings, String key, boolean fallback) {
        Object value = settings.get(key);
        return value instanceof Boolean flag ? flag : fallback;
    }

    public static long count(Map<String, Object> settings, String key, long fallback) {
        Object value = settings.get(key);
        return value instanceof Long number ? number : fallback;
    }
}
