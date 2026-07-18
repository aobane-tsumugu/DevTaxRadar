/// <reference types="node" />

import { createHmac } from "node:crypto";
import { basename, normalize, resolve } from "node:path";

export function privateKey(
  kind: "project" | "session" | "message",
  rawValue: string,
  salt: string,
): string {
  if (salt.length < 16) {
    throw new Error("identifierSalt must be at least 16 characters");
  }

  const normalized = kind === "project"
    ? normalize(resolve(rawValue)).toLocaleLowerCase("en-US")
    : rawValue;
  const digest = createHmac("sha256", salt)
    .update(`${kind}\0${normalized}`)
    .digest("hex")
    .slice(0, 24);
  return `${kind}_${digest}`;
}

export function localProjectLabel(rawPath: string): string {
  const label = basename(normalize(rawPath))
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return label.slice(0, 120) || "名称未取得";
}
