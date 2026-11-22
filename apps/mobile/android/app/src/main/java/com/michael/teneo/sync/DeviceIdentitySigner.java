package com.michael.teneo.sync;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import java.math.BigInteger;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;

/** Sync identity; only public bytes and message signatures leave the Keystore. */
final class DeviceIdentitySigner {

    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS = "teneo-sync-device-identity-v1";

    private final PrivateKey key;
    private final byte[] publicKey;

    private DeviceIdentitySigner(PrivateKey key, byte[] publicKey) {
        this.key = key;
        this.publicKey = publicKey;
    }

    /**
     * Only explicit enrollment may set create. A missing key for an enrolled
     * device means re-pairing is required, not that it may replace its identity.
     */
    static synchronized DeviceIdentitySigner open(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(PROVIDER);
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            if (!create) throw new GeneralSecurityException("Sync identity is missing");
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER);
            generator.initialize(
                new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    // Sync may need to sign while the phone is locked.
                    .setUserAuthenticationRequired(false)
                    .build()
            );
            generator.generateKeyPair();
        }
        if (!(store.getEntry(ALIAS, null) instanceof KeyStore.PrivateKeyEntry entry)) {
            throw new GeneralSecurityException("Sync identity is unavailable");
        }
        PrivateKey key = entry.getPrivateKey();
        KeyInfo info = KeyFactory.getInstance(key.getAlgorithm(), PROVIDER).getKeySpec(key, KeyInfo.class);
        if (!protectedByHardware(info)) {
            throw new GeneralSecurityException("Hardware-protected sync identities are unavailable");
        }
        ECPublicKey ec = (ECPublicKey) entry.getCertificate().getPublicKey();
        byte[] point = new byte[65];
        point[0] = 4;
        writeCoordinate(ec.getW().getAffineX(), point, 1);
        writeCoordinate(ec.getW().getAffineY(), point, 33);
        return new DeviceIdentitySigner(key, point);
    }

    @SuppressWarnings("deprecation")
    private static boolean protectedByHardware(KeyInfo info) {
        if (Build.VERSION.SDK_INT < 31) return info.isInsideSecureHardware();
        int level = info.getSecurityLevel();
        return level == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT || level == KeyProperties.SECURITY_LEVEL_STRONGBOX;
    }

    byte[] publicKey() {
        return publicKey.clone();
    }

    byte[] sign(byte[] message) throws GeneralSecurityException {
        if (message.length == 0 || message.length > 16_384) {
            throw new GeneralSecurityException("Invalid sync proof length");
        }
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        signature.update(message);
        return p1363(signature.sign());
    }

    private static void writeCoordinate(BigInteger n, byte[] out, int offset) {
        byte[] value = n.toByteArray();
        int size = Math.min(value.length, 32);
        System.arraycopy(value, value.length - size, out, offset + 32 - size, size);
    }

    /** The Keystore returns DER; WebCrypto verifies fixed-width r || s. */
    static byte[] p1363(byte[] der) throws GeneralSecurityException {
        if (der.length < 8 || der.length > 72 || der[0] != 0x30 || der[1] != der.length - 2) {
            throw new GeneralSecurityException("Invalid ECDSA signature");
        }
        byte[] out = new byte[64];
        int cursor = 2;
        for (int offset = 0; offset <= 32; offset += 32) {
            if (cursor + 2 >= der.length || der[cursor++] != 2) {
                throw new GeneralSecurityException("Invalid ECDSA integer");
            }
            int length = der[cursor++] & 0xff;
            if (length < 1 || length > 33 || cursor + length > der.length || der[cursor] < 0) {
                throw new GeneralSecurityException("Invalid ECDSA integer");
            }
            if (length > 1 && der[cursor] == 0 && der[cursor + 1] < 0) {
                cursor++;
                length--;
            }
            if (length > 32 || (length > 1 && der[cursor] == 0)) {
                throw new GeneralSecurityException("Invalid ECDSA integer");
            }
            System.arraycopy(der, cursor, out, offset + 32 - length, length);
            cursor += length;
        }
        if (cursor != der.length) throw new GeneralSecurityException("Invalid ECDSA signature");
        return out;
    }
}
