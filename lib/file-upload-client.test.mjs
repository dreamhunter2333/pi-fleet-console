import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { dropMentionText, splitDroppedItems, uploadFiles } = await jiti.import("./file-upload-client.ts");
const { installFleetTransport } = await jiti.import("./fleet-client.ts");

const file = (name, type = "") => new File(["x"], name, { type });

test("a chat drop attaches images, uploads other files, and leaves folders out", () => {
  const photo = file("photo.png", "image/png");
  const notes = file("notes.md", "text/markdown");
  const data = file("data.bin");
  const result = splitDroppedItems([
    { kind: "file", file: photo },
    { kind: "file", file: notes },
    { kind: "folder", name: "src" },
    { kind: "file", file: data },
  ]);
  assert.deepEqual(result.images, [photo]);
  assert.deepEqual(result.files, [notes, data]);
  assert.deepEqual(result.folders, ["src"]);
});

test("mentions follow the drop order and only name files now in the working directory", () => {
  const files = [file("b.txt"), file("my notes.md"), file("failed.log"), file("a.txt")];
  assert.equal(
    dropMentionText(files, ["a.txt", "my notes.md", "b.txt"]),
    '@b.txt @"my notes.md" @a.txt ',
  );
  assert.equal(dropMentionText(files, []), "");
});

test("XHR uploads retain progress and follow the selected Fleet machine", async () => {
  const requests = [];
  globalThis.window = {
    location: { href: "https://fleet.example/", origin: "https://fleet.example" },
    fetch: async () => {},
    EventSource: class {},
    open() {},
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 200;
    responseText = JSON.stringify({ uploaded: ["notes.txt"] });
    open(method, url) { requests.push({ method, url }); }
    send(body) {
      assert.equal(body.get("files").name, "notes.txt");
      this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 });
      this.onload();
    }
  };
  let restore = () => {};
  try {
    const files = [file("notes.txt")];
    await uploadFiles("/tmp/notes", files, "skip");
    assert.equal(requests.at(-1).url, "/api/files/tmp/notes?type=upload&conflict=skip");
    for (const machine of ["dev-android", "mac"]) {
      restore = installFleetTransport(machine);
      const progress = [];
      const result = await uploadFiles("/tmp/notes", files, "error", (value) => progress.push(value));
      assert.deepEqual(requests.at(-1), {
        method: "POST",
        url: `https://fleet.example/api/fleet/events/${machine}/files/tmp/notes?type=upload&conflict=error`,
      });
      assert.deepEqual(result, { status: 200, data: { uploaded: ["notes.txt"] } });
      assert.deepEqual(progress, [50]);
      restore();
    }
    await uploadFiles("/tmp/notes", files, "overwrite");
    assert.equal(requests.at(-1).url, "/api/files/tmp/notes?type=upload&conflict=overwrite");
  } finally {
    restore();
    delete globalThis.XMLHttpRequest;
    delete globalThis.document;
    delete globalThis.window;
  }
});
