package com.michael.teneo.sync;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-256-GCM with a key made in, and never leaving, the Android Keystore */
final class KeystoreCipher implements VaultKeyStore.Cipher {

    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS = "teneo-sync-vault-key";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;

    @Override
    public byte[][] encrypt(byte[] plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        // the Keystore picks the nonce: a key that requires random ones won't take ours
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        byte[] sealed = cipher.doFinal(plain);
        return new byte[][] { cipher.getIV(), sealed };
    }

    @Override
    public byte[] decrypt(byte[] nonce, byte[] sealed) throws Exception {
        SecretKey key = key(false);
        if (key == null) throw new IllegalStateException("the Keystore has no sync key");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
        return cipher.doFinal(sealed);
    }

    @Override
    public void forget() {
        try {
            KeyStore store = KeyStore.getInstance(PROVIDER);
            store.load(null);
            store.deleteEntry(ALIAS);
        } catch (Exception ignored) {
            // no key, or no Keystore: either way nothing can be decrypted
        }
    }

    private static SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(PROVIDER);
        store.load(null);
        if (store.getKey(ALIAS, null) instanceof SecretKey existing) return existing;
        if (!create) return null;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        generator.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                // the service reads it at boot with the screen locked, so no
                // unlock may be required: only this app can use it, on this phone
                .setUserAuthenticationRequired(false)
                .build()
        );
        return generator.generateKey();
    }
}
