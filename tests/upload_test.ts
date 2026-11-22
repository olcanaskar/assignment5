// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { createTask, registerAndLogin } from "./helpers.ts";

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
