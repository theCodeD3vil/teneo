package com.michael.teneo.history;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The files of the history's images: one per image item, in a folder of the
 * app's own, named by this class and never by what another device says. No
 * database and no Android in here, so JUnit can test it.
 */
public final class ImageFiles {

    /** The kinds of image every device can show (packages/sync imageTypes); any other is not synced */
    public static final List<String> TYPES = Collections.unmodifiableList(
        Arrays.asList("image/png", "image/jpeg", "image/gif", "image/webp")
    );

    private static final Pattern NAME = Pattern.compile("^[0-9a-f-]{36}\\.(png|jpg|gif|webp)$");
    private static final Pattern HASH = Pattern.compile("^[0-9a-f]{64}$");

    private final File folder;

    /** `folder` need not exist yet */
    public ImageFiles(File folder) {
        this.folder = folder;
    }

    static String extension(String type) {
        if ("image/png".equals(type)) return "png";
        if ("image/jpeg".equals(type)) return "jpg";
        if ("image/gif".equals(type)) return "gif";
        if ("image/webp".equals(type)) return "webp";
        return null;
    }

    /** The kind of image these first bytes begin, or null when they begin none that is synced */
    public static String typeOf(byte[] head) {
        for (String type : TYPES) if (looksLike(type, head)) return type;
        return null;
    }

    /** Whether bytes begin the way an image of this kind does */
    public static boolean looksLike(String type, byte[] head) {
        if ("image/png".equals(type)) return starts(head, 0, 0x89, 0x50, 0x4e, 0x47);
        if ("image/jpeg".equals(type)) return starts(head, 0, 0xff, 0xd8, 0xff);
        if ("image/gif".equals(type)) return starts(head, 0, 0x47, 0x49, 0x46, 0x38);
        // "RIFF", four bytes of length, "WEBP"
        if ("image/webp".equals(type)) return starts(head, 0, 0x52, 0x49, 0x46, 0x46) && starts(head, 8, 0x57, 0x45, 0x42, 0x50);
        return false;
    }

    private static boolean starts(byte[] bytes, int at, int... signature) {
        if (bytes == null || bytes.length < at + signature.length) return false;
        for (int i = 0; i < signature.length; i++) {
            if ((bytes[at + i] & 0xff) != signature[i]) return false;
        }
        return true;
    }

    public static boolean isHash(String hash) {
        return hash != null && HASH.matcher(hash).matches();
    }

    /** The first bytes of a file: enough to tell what kind of image it is */
    public static byte[] head(File file) throws IOException {
        byte[] head = new byte[16];
        try (InputStream in = new FileInputStream(file)) {
            int read = in.read(head);
            return Arrays.copyOf(head, Math.max(read, 0));
        }
    }

    /** SHA-256 of a file, in hex, as a sync record names an image */
    public static String sha256(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] chunk = new byte[64 * 1024];
            for (int read = in.read(chunk); read >= 0; read = in.read(chunk)) digest.update(chunk, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte part : digest.digest()) hex.append(String.format("%02x", part));
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** The file a row's `path` names, or null for a name this class never gave */
    public File file(String name) {
        return name != null && NAME.matcher(name).matches() ? new File(folder, name) : null;
    }

    /** Copy `source` in as an image of `type`, under a new name: the name, to keep in the row */
    public String keep(File source, String type) throws IOException {
        String extension = extension(type);
        if (extension == null) throw new IOException("Not a kind of image that is kept");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("The images folder could not be made");
        String name = UUID.randomUUID() + "." + extension;
        Files.copy(source.toPath(), new File(folder, name).toPath(), StandardCopyOption.REPLACE_EXISTING);
        return name;
    }

    /** Remove the file a row named; a name that is none of ours is left alone */
    public void remove(String name) {
        File file = file(name);
        if (file != null) file.delete();
    }

    /** Where the pieces of an image that is arriving are put together, or null for what is no hash */
    public File arriving(String hash) throws IOException {
        if (!isHash(hash)) return null;
        File incoming = new File(folder, "arriving");
        if (!incoming.isDirectory() && !incoming.mkdirs()) throw new IOException("The images folder could not be made");
        return new File(incoming, hash + ".part");
    }

    /** Forget the pieces of images that never finished arriving: each is asked for again from its start */
    public void forgetArriving() {
        File[] parts = new File(folder, "arriving").listFiles();
        if (parts == null) return;
        for (File part : parts) part.delete();
    }
}
