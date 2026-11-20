package com.michael.teneo.updates;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Arrays;
import java.util.Random;
import org.junit.Test;

public class Ed25519Test {

    private static byte[] hex(String text) {
        byte[] bytes = new byte[text.length() / 2];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(text.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    /** The JDK's X.509 encoding of an Ed25519 key ends in the 32 raw bytes */
    private static byte[] raw(KeyPair pair) {
        byte[] encoded = pair.getPublic().getEncoded();
        return Arrays.copyOfRange(encoded, encoded.length - 32, encoded.length);
    }

    private static byte[] sign(KeyPair pair, byte[] message) throws Exception {
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(pair.getPrivate());
        signer.update(message);
        return signer.sign();
    }

    @Test
    public void acceptsRfc8032TestVectors() {
        // RFC 8032 section 7.1, TEST 1 (empty message) and TEST 2 (one byte)
        assertTrue(
            Ed25519.verify(
                hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"),
                new byte[0],
                hex(
                    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
                )
            )
        );
        assertTrue(
            Ed25519.verify(
                hex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c"),
                hex("72"),
                hex(
                    "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"
                )
            )
        );
    }

    @Test
    public void agreesWithTheJdkOnSignaturesAndTamperedOnes() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        Random random = new Random(20261120);
        for (int round = 0; round < 200; round++) {
            KeyPair pair = generator.generateKeyPair();
            byte[] message = new byte[random.nextInt(300)];
            random.nextBytes(message);
            byte[] signature = sign(pair, message);
            byte[] key = raw(pair);
            assertTrue(Ed25519.verify(key, message, signature));

            byte[] badSignature = signature.clone();
            badSignature[random.nextInt(64)] ^= (byte) (1 << random.nextInt(8));
            assertFalse(Ed25519.verify(key, message, badSignature));

            if (message.length > 0) {
                byte[] badMessage = message.clone();
                badMessage[random.nextInt(message.length)] ^= 1;
                assertFalse(Ed25519.verify(key, badMessage, signature));
            }

            KeyPair other = generator.generateKeyPair();
            assertFalse(Ed25519.verify(raw(other), message, signature));
        }
    }

    @Test
    public void rejectsMalformedInput() throws Exception {
        KeyPair pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        byte[] message = "teneo".getBytes(StandardCharsets.UTF_8);
        byte[] signature = sign(pair, message);
        byte[] key = raw(pair);
        assertFalse(Ed25519.verify(null, message, signature));
        assertFalse(Ed25519.verify(key, message, null));
        assertFalse(Ed25519.verify(Arrays.copyOf(key, 31), message, signature));
        assertFalse(Ed25519.verify(key, message, Arrays.copyOf(signature, 63)));

        // S + L is the same signature written another way: refused
        java.math.BigInteger order = java.math.BigInteger.ONE.shiftLeft(252).add(new java.math.BigInteger("27742317777372353535851937790883648493"));
        byte[] sBytes = Arrays.copyOfRange(signature, 32, 64);
        byte[] bigEndian = new byte[33];
        for (int i = 0; i < 32; i++) bigEndian[32 - i] = sBytes[i];
        java.math.BigInteger s = new java.math.BigInteger(bigEndian).add(order);
        byte[] sum = s.toByteArray();
        byte[] malleable = signature.clone();
        for (int i = 0; i < 32; i++) malleable[32 + i] = i < sum.length ? sum[sum.length - 1 - i] : 0;
        if (s.bitLength() <= 256) assertFalse(Ed25519.verify(key, message, malleable));

        // a key that is no point on the curve
        byte[] notAPoint = new byte[32];
        notAPoint[0] = 2;
        assertFalse(Ed25519.verify(notAPoint, message, signature));
    }
}
