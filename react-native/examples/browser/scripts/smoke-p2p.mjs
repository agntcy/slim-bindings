#!/usr/bin/env node
/**
 * Headless smoke test: point-to-point Alice + Bob against a running dev server.
 * Usage: node scripts/smoke-p2p.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";

const browser = await chromium.launch();
const context = await browser.newContext();
const alice = await context.newPage();
const bob = await context.newPage();

function log(label, text) {
  console.log(`[${label}] ${text?.trim().split("\n").slice(-3).join(" | ")}`);
}

try {
  await alice.goto(`${base}/point-to-point-alice.html`, { waitUntil: "networkidle" });
  await bob.goto(`${base}/point-to-point-bob.html`, { waitUntil: "networkidle" });

  const wasmReady = async (page) =>
    page.waitForFunction(
      () => document.getElementById("wasm-status")?.textContent === "WASM ready",
      { timeout: 120_000 },
    );

  console.log("Waiting for WASM…");
  await Promise.all([wasmReady(alice), wasmReady(bob)]);

  console.log("Starting Alice…");
  await alice.click("#start");
  await alice.waitForFunction(
    () => (document.getElementById("log")?.textContent ?? "").includes("Waiting for incoming sessions"),
    { timeout: 30_000 },
  );

  console.log("Starting Bob…");
  await bob.click("#start");
  await bob.waitForFunction(
    () => (document.getElementById("log")?.textContent ?? "").includes("Received reply"),
    { timeout: 60_000 },
  );

  const aliceLog = await alice.locator("#log").textContent();
  const bobLog = await bob.locator("#log").textContent();

  log("Alice", aliceLog);
  log("Bob", bobLog);

  if (!(bobLog ?? "").includes("Received reply")) {
    throw new Error("Bob did not receive Alice's reply");
  }
  if (!(aliceLog ?? "").includes("Incoming session accepted")) {
    throw new Error("Alice did not accept a session");
  }

  console.log("✅ Point-to-point smoke test passed");
} catch (error) {
  const dump = async (label, page) => {
    const log = await page.locator("#log").textContent().catch(() => "");
    console.error(`\n--- ${label} log ---\n${log ?? "(empty)"}\n`);
  };
  await dump("Alice", alice);
  await dump("Bob", bob);
  throw error;
} finally {
  await browser.close();
}
