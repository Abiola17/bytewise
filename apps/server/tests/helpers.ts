import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp, type AppDependencies } from "../src/app";
import { loadConfig, type Env } from "../src/config/env";
import type { ModelProvider } from "../src/providers/model-provider";
import type { SegmentationProvider } from "../src/providers/meta/meta.segmentation";
import type { TranscriptionProvider } from "../src/providers/meta/meta.transcription";

/** Tests must never reach a real model API; this one fails loudly if called. */
const noNetworkProvider: ModelProvider = {
  name: "none",
  model: "none",
  async generateStructured() {
    throw new Error("Test attempted a model call without providing a test provider.");
  },
};

const noNetworkTranscription: TranscriptionProvider = {
  model: "none",
  async transcribe() {
    throw new Error("Test attempted a transcription call without providing a test provider.");
  },
};

const noNetworkSegmentation: SegmentationProvider = {
  model: "none",
  async segment() {
    throw new Error("Test attempted a segmentation call without providing a test provider.");
  },
};

/** Builds an app with an in-memory database and throwaway projects/screenshot directories. */
export async function createTestApp(
  dependencies: AppDependencies = {},
  env: Partial<Record<keyof Env, string>> = {},
) {
  const projectsDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-projects-")));
  const screenshotsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bytewise-shots-"));
  const config = loadConfig({
    DATABASE_PATH: ":memory:",
    PROJECTS_DIR: projectsDir,
    SCREENSHOTS_DIR: screenshotsDir,
    LOG_LEVEL: "silent",
    ...env,
  });
  const app = await buildApp(config, {
    modelProvider: noNetworkProvider,
    transcriptionProvider: noNetworkTranscription,
    segmentationProvider: noNetworkSegmentation,
    ...dependencies,
  });

  return {
    app,
    config,
    projectsDir,
    async cleanup() {
      await app.close();
      fs.rmSync(projectsDir, { recursive: true, force: true });
      fs.rmSync(screenshotsDir, { recursive: true, force: true });
    },
  };
}
