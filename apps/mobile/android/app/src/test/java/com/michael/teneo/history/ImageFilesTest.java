package com.michael.teneo.history;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ImageFilesTest {

    @Rule
    public TemporaryFolder temporary = new TemporaryFolder();

    private static final byte[] PNG = { (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3 };
    private static final byte[] JPEG = { (byte) 0xff, (byte) 0xd8, (byte) 0xff, (byte) 0xe0, 1, 2 };
    private static final byte[] GIF = { 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 };
    private static final byte[] WEBP = { 0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50 };

    private File write(String name, byte[] bytes) throws IOException {
        File file = temporary.newFile(name);
        Files.write(file.toPath(), bytes);
        return file;
    }

    @Test
    public void anImageIsToldByHowItBegins() {
        assertEquals("image/png", ImageFiles.typeOf(PNG));
        assertEquals("image/jpeg", ImageFiles.typeOf(JPEG));
        assertEquals("image/gif", ImageFiles.typeOf(GIF));
        assertEquals("image/webp", ImageFiles.typeOf(WEBP));
        assertNull(ImageFiles.typeOf("<svg onload=alert(1)>".getBytes()));
        assertNull(ImageFiles.typeOf(new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45 }));
        assertNull(ImageFiles.typeOf(new byte[0]));
        assertNull(ImageFiles.typeOf(null));
        assertTrue(ImageFiles.looksLike("image/png", PNG));
        assertFalse(ImageFiles.looksLike("image/jpeg", PNG));
        assertFalse(ImageFiles.looksLike("image/heic", PNG));
    }

    @Test
    public void aFileIsNamedByItsHash() throws IOException {
        // "abc"
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ImageFiles.sha256(write("abc", "abc".getBytes())));
        assertTrue(ImageFiles.isHash("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        assertFalse(ImageFiles.isHash("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"));
        assertFalse(ImageFiles.isHash("../../databases/teneo.sqlite"));
        assertFalse(ImageFiles.isHash(null));
    }

    @Test
    public void anImageIsKeptUnderANameOfItsOwnAndGoesByIt() throws IOException {
        ImageFiles images = new ImageFiles(new File(temporary.getRoot(), "images"));
        File source = write("shot", PNG);
        String first = images.keep(source, "image/png");
        String second = images.keep(source, "image/jpeg");
        assertTrue(first.matches("[0-9a-f-]{36}\\.png"));
        assertTrue(second.endsWith(".jpg"));
        assertNotEquals(first, second);
        assertArrayEquals(PNG, Files.readAllBytes(images.file(first).toPath()));
        assertTrue(source.isFile());

        images.remove(first);
        assertFalse(images.file(first).exists());
        assertTrue(images.file(second).isFile());
        assertThrows(IOException.class, () -> images.keep(source, "image/heic"));
    }

    @Test
    public void aNameThatIsNotOneOfItsOwnIsNeverAFile() throws IOException {
        ImageFiles images = new ImageFiles(new File(temporary.getRoot(), "images"));
        File outside = write("teneo.sqlite", "history".getBytes());
        for (String name : new String[] { "../teneo.sqlite", "/etc/hosts", "shot.png", "", null, "arriving" }) {
            assertNull(String.valueOf(name), images.file(name));
            images.remove(name);
        }
        assertTrue(outside.isFile());
    }

    @Test
    public void piecesOfAnArrivingImageAreKeptApartAndForgotten() throws IOException {
        ImageFiles images = new ImageFiles(new File(temporary.getRoot(), "images"));
        String hash = "ab".repeat(32);
        File part = images.arriving(hash);
        assertEquals(hash + ".part", part.getName());
        assertNull(images.arriving("../../x"));
        Files.write(part.toPath(), PNG);
        String kept = images.keep(write("shot", PNG), "image/png");
        images.forgetArriving();
        assertFalse(part.exists());
        assertTrue(images.file(kept).isFile());
    }
}
