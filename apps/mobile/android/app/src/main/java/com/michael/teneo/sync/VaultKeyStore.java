package com.michael.teneo.sync;

import java.util.Arrays;
import java.util.Base64;

/**
 * The vault key, kept encrypted by a key that never leaves the Android
 * Keystore. What is stored is useless without this phone's Keystore, and the
 * app's files are never in a backup (see the manifest). The key itself is
 * never logged.
 *
 * The storage and the cipher are passed in, so the format and the failure
 * cases are tested on the JVM; KeystoreCipher is the real cipher.
 */
public final class VaultKeyStore {

    public static final int KEY_LENGTH = 32;

    /** Encrypts with a key only it holds */
    public interface Cipher {
        /** The nonce, then the sealed bytes */
        byte[][] encrypt(byte[] plain) throws Exception;

        byte[] decrypt(byte[] nonce, byte[] sealed) throws Exception;

        /** Delete the key: nothing it encrypted can be read again */
        void forget();
    }

    /** Where the sealed key is kept */
    public interface Storage {
        String get(String name);

        /** False when it couldn't be written */
        boolean put(String name, String value);

        boolean remove(String name);
    }

    /** What reading gave: a key, nothing stored, or something unreadable */
    public static final class Read {

        public final byte[] key;
        public final boolean unreadable;

        private Read(byte[] key, boolean unreadable) {
            this.key = key;
            this.unreadable = unreadable;
        }
    }

    static final String NAME = "vaultKey";
    private static final String VERSION = "v1";

    private final Storage storage;
    private final Cipher cipher;

    public VaultKeyStore(Storage storage, Cipher cipher) {
        this.storage = storage;
        this.cipher = cipher;
    }

    /** Whether a key is stored, readable or not: the phone is paired */
    public boolean has() {
        return storage.get(NAME) != null;
    }

    /** Keep `key`. False, with nothing stored, when it can't be kept safely. */
    public boolean save(byte[] key) {
        if (key == null || key.length != KEY_LENGTH) return false;
        byte[][] sealed;
        try {
            sealed = cipher.encrypt(key);
        } catch (Exception failed) {
            return false;
        }
        Base64.Encoder base64 = Base64.getEncoder();
        String value = VERSION + ":" + base64.encodeToString(sealed[0]) + ":" + base64.encodeToString(sealed[1]);
        if (storage.put(NAME, value)) return true;
        storage.remove(NAME);
        return false;
    }

    public Read read() {
        String value = storage.get(NAME);
        if (value == null) return new Read(null, false);
        String[] parts = value.split(":", -1);
        if (parts.length != 3 || !parts[0].equals(VERSION)) return new Read(null, true);
        byte[] key;
        try {
            Base64.Decoder base64 = Base64.getDecoder();
            key = cipher.decrypt(base64.decode(parts[1]), base64.decode(parts[2]));
        } catch (Exception failed) {
            return new Read(null, true);
        }
        if (key == null || key.length != KEY_LENGTH) {
            if (key != null) Arrays.fill(key, (byte) 0);
            return new Read(null, true);
        }
        return new Read(key, false);
    }

    /** Forget the key: the stored copy and the Keystore key that sealed it */
    public void forget() {
        storage.remove(NAME);
        cipher.forget();
    }
}
