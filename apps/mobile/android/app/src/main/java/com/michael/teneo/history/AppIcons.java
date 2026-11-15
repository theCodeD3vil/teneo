package com.michael.teneo.history;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * The icons of the Mac apps items were copied from. An item says only its
 * app's name, and a phone has none of those apps, so sync asks a Mac for each
 * icon once (the sync core's AppIconSink) and it is kept here by name: one
 * file per app, shown for every item from an app of that name.
 *
 * An icon comes from another device: only a png, and only a small one, is
 * ever written, and the app shows it as an image and nothing else.
 */
public final class AppIcons {

    public interface Listener {
        /** An icon was saved for an app that had none */
        void onIconsChanged();
    }

    /** The folder, inside the app's files, that holds them */
    public static final String FOLDER = "app-icons";

    /** As the sync core's iconLimits */
    public static final int MAX_BYTES = 64 * 1024;
    public static final int MAX_NAME_LENGTH = 256;

    private static final byte[] PNG_SIGNATURE = { (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };

    // the sync service saves icons and the app's page shows them: one process
    private static final Set<Listener> listeners = new CopyOnWriteArraySet<>();

    private final File folder;

    /** `folder` need not exist yet */
    public AppIcons(File folder) {
        this.folder = folder;
    }

    public static void addListener(Listener listener) {
        listeners.add(listener);
    }

    public static void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    public static boolean isPng(byte[] bytes) {
        if (bytes == null || bytes.length <= PNG_SIGNATURE.length || bytes.length > MAX_BYTES) return false;
        for (int i = 0; i < PNG_SIGNATURE.length; i++) {
            if (bytes[i] != PNG_SIGNATURE[i]) return false;
        }
        return true;
    }

    private static boolean isName(String name) {
        return name != null && !name.isEmpty() && name.length() <= MAX_NAME_LENGTH;
    }

    /** A name can hold anything, a path among it: the file is named by its hash */
    private File file(String name) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(name.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte part : hash) hex.append(String.format("%02x", part));
            return new File(folder, hex + ".png");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** Which of these apps have no icon here */
    public List<String> missing(List<String> names) {
        List<String> missing = new ArrayList<>();
        for (String name : names) {
            if (isName(name) && !file(name).isFile()) missing.add(name);
        }
        return missing;
    }

    /** The app's icon, or null when there is none */
    public byte[] read(String name) {
        if (!isName(name)) return null;
        File file = file(name);
        if (!file.isFile()) return null;
        try {
            byte[] png = Files.readAllBytes(file.toPath());
            return isPng(png) ? png : null;
        } catch (IOException unreadable) {
            return null;
        }
    }

    /** Keep `png` as the app's icon. False when it isn't one, or can't be written. */
    public boolean save(String name, byte[] png) {
        if (!isName(name) || !isPng(png)) return false;
        File file = file(name);
        // whole or not at all: a half-written icon would show as a broken image
        File partial = new File(folder, file.getName() + ".part");
        try {
            if (!folder.isDirectory() && !folder.mkdirs()) return false;
            try (FileOutputStream out = new FileOutputStream(partial)) {
                out.write(png);
            }
            if (!partial.renameTo(file)) {
                partial.delete();
                return false;
            }
        } catch (IOException unwritable) {
            partial.delete();
            return false;
        }
        for (Listener listener : listeners) listener.onIconsChanged();
        return true;
    }
}
