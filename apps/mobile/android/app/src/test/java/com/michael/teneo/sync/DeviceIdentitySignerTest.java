package com.michael.teneo.sync;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.security.GeneralSecurityException;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import org.junit.Test;

public class DeviceIdentitySignerTest {

    @Test
    public void convertsDerFromASignerToTheWebCryptoFormat() throws Exception {
        var generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        var pair = generator.generateKeyPair();
        byte[] message = { 1, 2, 3 };

        var der = Signature.getInstance("SHA256withECDSA");
        der.initSign(pair.getPrivate());
        der.update(message);
        byte[] converted = DeviceIdentitySigner.p1363(der.sign());
        var verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(pair.getPublic());
        verifier.update(message);
        assertTrue(verifier.verify(converted));
    }

    @Test
    public void padsBothIntegersAndRejectsInvalidEncodings() throws Exception {
        byte[] expected = new byte[64];
        expected[31] = 1;
        expected[63] = (byte) 0xfe;
        assertArrayEquals(
            expected,
            DeviceIdentitySigner.p1363(new byte[] { 0x30, 7, 2, 1, 1, 2, 2, 0, (byte) 0xfe })
        );
        assertThrows(
            GeneralSecurityException.class,
            () -> DeviceIdentitySigner.p1363(new byte[] { 0x30, 6, 2, 1, (byte) 0xfe, 2, 1, 1 })
        );
    }
}
