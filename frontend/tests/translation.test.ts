import assert from "node:assert/strict";
import test from "node:test";
import { buildTranslationMap, isUsableTranslation } from "../src/utils/translation.ts";

test("old source echoes in database and localStorage remain missing, so automatic translation can repair them", () => {
  const sources = [{ logical_segment_id: "one", text: "Xin chào mọi người." }];
  const stored = [{ segments: [{ logical_segment_id: "one", text: "XIN CHÀO MỌI NGƯỜI!" }] }];
  const live = { one: { text: "Xin chào mọi người." } };
  assert.equal(buildTranslationMap(sources, stored, live).size, 0);
  assert.equal(buildTranslationMap(sources, stored, { one: { text: "Hello everyone." } }).get("one"), "Hello everyone.");
});

test("valid server translation wins over stale local cache and invalid newest record", () => {
  const source = [{ logical_segment_id: "one", text: "Xin chào mọi người" }];
  const translations = [
    { segments: [{ logical_segment_id: "one", text: "Xin chào mọi người" }] },
    { segments: [{ logical_segment_id: "one", text: "Hello everyone" }] },
  ];
  assert.equal(buildTranslationMap(source, translations, { one: { text: "Xin chào mọi người" } }).get("one"), "Hello everyone");
});

test("empty translation is missing; unchanged numbers and short interjections are allowed", () => {
  assert.equal(isUsableTranslation("Xin chào", ""), false);
  assert.equal(isUsableTranslation("Xin chào", "..."), false);
  for (const text of ["2026", "OK", "AI"]) assert.equal(isUsableTranslation(text, text), true);
});
