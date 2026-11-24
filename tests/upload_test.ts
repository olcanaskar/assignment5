// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { createTask, registerAndLogin } from "./helpers.ts";

const fileExists = async (path: string) => {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
};

Deno.test("Bonus 12: upload and download an image attachment", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const uploadDir = await Deno.makeTempDir();
  const db = createDb(`file:${file}`);
  await migrate(db);
  const app = createApp(db, undefined, undefined, uploadDir);

  try {
    const token = await registerAndLogin(app, "upload@example.com");
    const headers = { authorization: `Bearer ${token}` };
    const created = await createTask(app, token, { title: "With image" });
    const { id } = await created.json() as { id: number };

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png", {
        type: "image/png",
      }),
    );

    const uploaded = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers,
      body: form,
    });
    assertEquals(uploaded.status, 200);

    const body = await uploaded.json() as { attachment: string | null };
    assertEquals(typeof body.attachment, "string");
    assertEquals(body.attachment === "a.png", false);

    const downloaded = await app.request(`/api/tasks/${id}/attachment`, {
      headers,
    });
    assertEquals(downloaded.status, 200);
    assertEquals(downloaded.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    assertEquals(bytes.length, 8);
    assertEquals(bytes[0], 137);

    const otherToken = await registerAndLogin(app, "upload-other@example.com");
    const forbidden = await app.request(`/api/tasks/${id}/attachment`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assertEquals(forbidden.status, 404);

    const noAttachment = await createTask(app, token, { title: "No image" });
    const noId = (await noAttachment.json() as { id: number }).id;
    const missing = await app.request(`/api/tasks/${noId}/attachment`, {
      headers,
    });
    assertEquals(missing.status, 404);
  } finally {
    db.client.close();
    await Deno.remove(uploadDir, { recursive: true }).catch(() => {});
    await Deno.remove(file).catch(() => {});
  }
});

Deno.test("Bonus 12: replacing an attachment removes the old file and accepts JPEG", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const uploadDir = await Deno.makeTempDir();
  const db = createDb(`file:${file}`);
  await migrate(db);
  const app = createApp(db, undefined, undefined, uploadDir);

  try {
    const token = await registerAndLogin(app, "upload-replace@example.com");
    const headers = { authorization: `Bearer ${token}` };
    const created = await createTask(app, token, { title: "Replace image" });
    const { id } = await created.json() as { id: number };

    const pngForm = new FormData();
    pngForm.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "first.png", {
        type: "image/png",
      }),
    );
    const first = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers,
      body: pngForm,
    });
    assertEquals(first.status, 200);
    const firstBody = await first.json() as { attachment: string | null };
    if (!firstBody.attachment) throw new Error("first attachment missing");
    const oldPath = join(uploadDir, firstBody.attachment);
    assertEquals(await fileExists(oldPath), true);

    const jpegForm = new FormData();
    jpegForm.set(
      "file",
      new File([new Uint8Array([255, 216, 255, 224])], "second.jpg", {
        type: "image/jpeg",
      }),
    );
    const second = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers,
      body: jpegForm,
    });
    assertEquals(second.status, 200);
    const secondBody = await second.json() as { attachment: string | null };
    if (!secondBody.attachment) throw new Error("second attachment missing");
    assertEquals(secondBody.attachment === firstBody.attachment, false);
    assertEquals(await fileExists(oldPath), false);

    const downloaded = await app.request(`/api/tasks/${id}/attachment`, {
      headers,
    });
    assertEquals(downloaded.status, 200);
    assertEquals(downloaded.headers.get("content-type"), "image/jpeg");
    assertEquals(new Uint8Array(await downloaded.arrayBuffer()).length, 4);
  } finally {
    db.client.close();
    await Deno.remove(uploadDir, { recursive: true }).catch(() => {});
    await Deno.remove(file).catch(() => {});
  }
});

Deno.test("Bonus 12: file validation rejects missing, large and wrong-type files", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const uploadDir = await Deno.makeTempDir();
  const db = createDb(`file:${file}`);
  await migrate(db);
  const app = createApp(db, undefined, undefined, uploadDir);

  try {
    const token = await registerAndLogin(app, "upload-errors@example.com");
    const headers = { authorization: `Bearer ${token}` };
    const created = await createTask(app, token, { title: "Upload errors" });
    const { id } = await created.json() as { id: number };

    const missingForm = new FormData();
    const missing = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers,
      body: missingForm,
    });
    assertEquals(missing.status, 400);

    const largeForm = new FormData();
    largeForm.set(
      "file",
      new File([new Uint8Array(1_000_001)], "large.png", { type: "image/png" }),
    );
    const large = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers,
      body: largeForm,
    });
    assertEquals(large.status, 413);

    const wrongForm = new FormData();
    wrongForm.set(
      "file",
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    );
    const wrong = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers,
      body: wrongForm,
    });
    assertEquals(wrong.status, 415);

    const otherToken = await registerAndLogin(app, "upload-errors-other@example.com");
    const foreign = await app.request(`/api/tasks/${id}/attachment`, {
      method: "POST",
      headers: { authorization: `Bearer ${otherToken}` },
      body: missingForm,
    });
    assertEquals(foreign.status, 404);
  } finally {
    db.client.close();
    await Deno.remove(uploadDir, { recursive: true }).catch(() => {});
    await Deno.remove(file).catch(() => {});
  }
});
