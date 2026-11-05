import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { API_PREFIX } from "@bytewise/shared";
import type { AppConfig } from "./config/env";
import { openDatabase } from "./database/client";
import { registerErrorHandler } from "./plugins/error-handler";
import { createModelProvider } from "./providers";
import type { ModelProvider } from "./providers/model-provider";
import {
  createMetaSegmentationProvider,
  type SegmentationProvider,
} from "./providers/meta/meta.segmentation";
import {
  createMetaTranscriptionProvider,
  type TranscriptionProvider,
} from "./providers/meta/meta.transcription";
import { createProjectsRepository } from "./repositories/projects.repository";
import { createSessionsRepository } from "./repositories/sessions.repository";
import { createPatchesRepository } from "./repositories/patches.repository";
import { createVerificationsRepository } from "./repositories/verifications.repository";
import { createProjectService } from "./services/project.service";
import { createProjectFilesService } from "./services/project-files.service";
import { createProjectImportService } from "./services/project-import.service";
import { createSessionService } from "./services/session.service";
import { createDiagnosisService } from "./services/diagnosis.service";
import { createDebuggingService } from "./services/debugging.service";
import { createMessageImagesService } from "./services/message-images.service";
import { createPatchService } from "./services/patch.service";
import { createVerificationService } from "./services/verification.service";
import { createDashboardService } from "./services/dashboard.service";
import { createMediaService } from "./services/media.service";
import { healthRoutes } from "./routes/health.routes";
import { projectRoutes } from "./routes/projects.routes";
import { fileRoutes } from "./routes/files.routes";
import { sessionRoutes } from "./routes/sessions.routes";
import { patchRoutes } from "./routes/patches.routes";
import { verificationRoutes } from "./routes/verification.routes";
import { dashboardRoutes } from "./routes/dashboard.routes";
import { mediaRoutes } from "./routes/media.routes";

export interface AppDependencies {
  /** Overrides the configured provider. Used by tests to avoid real API calls. */
  modelProvider?: ModelProvider;
  /** Voice and screenshot models are Meta-only; tests override them too. */
  transcriptionProvider?: TranscriptionProvider;
  segmentationProvider?: SegmentationProvider;
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.env.LOG_LEVEL,
      // Never log credentials, even if they end up on a request.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1024 * 1024,
  });

  const database = openDatabase(config.databasePath);

  await app.register(cors, { origin: config.env.WEB_ORIGIN });
  // Live dictation frames are small; anything bigger is not audio from the web app.
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  registerErrorHandler(app);

  const projectService = createProjectService({
    projects: createProjectsRepository(database.db),
    projectsDir: config.projectsDir,
  });
  const projectFiles = createProjectFilesService({ projectService });
  const sessions = createSessionsRepository(database.db);
  const patches = createPatchesRepository(database.db);
  const verifications = createVerificationsRepository(database.db);
  const interrupted = verifications.failInterrupted(new Date().toISOString());
  if (interrupted > 0)
    app.log.warn(`${interrupted} interrupted verification run(s) marked as error`);
  const sessionService = createSessionService({
    sessions,
    patches,
    verifications,
    projectService,
  });
  const provider = dependencies.modelProvider ?? createModelProvider(config);
  const diagnosisService = createDiagnosisService({ provider });
  const patchService = createPatchService({
    patches,
    sessions,
    sessionService,
    projectService,
    provider,
  });
  const verificationService = createVerificationService({
    verifications,
    patches,
    sessionService,
    projectService,
    limits: {
      timeoutMs: config.env.VERIFICATION_TIMEOUT_MS,
      maxOutputChars: config.env.VERIFICATION_MAX_OUTPUT_CHARS,
      killGraceMs: 2000,
    },
  });
  // Let background runs record their result, then close the database.
  app.addHook("onClose", async () => {
    await verificationService.drain();
    database.close();
  });
  const mediaService = createMediaService({
    db: database.db,
    sessionService,
    transcription:
      dependencies.transcriptionProvider ??
      createMetaTranscriptionProvider({
        apiKey: config.env.META_API_KEY,
        timeoutMs: config.env.MODEL_TIMEOUT_MS,
      }),
    segmentation:
      dependencies.segmentationProvider ??
      createMetaSegmentationProvider({
        apiKey: config.env.META_API_KEY,
        baseUrl: config.env.META_BASE_URL,
        timeoutMs: config.env.MODEL_TIMEOUT_MS,
      }),
    screenshotsDir: config.screenshotsDir,
  });
  const messageImages = createMessageImagesService({ sessions, dir: config.screenshotsDir });
  const debuggingService = createDebuggingService({
    sessions,
    verifications,
    sessionService,
    projectService,
    projectFiles,
    diagnosisService,
    messageImages,
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes({ config, pingDatabase: database.ping }));
      await api.register(
        projectRoutes({
          projectService,
          projectImport: createProjectImportService({
            projectService,
            projectsDir: config.projectsDir,
          }),
        }),
      );
      await api.register(fileRoutes({ projectFiles }));
      await api.register(sessionRoutes({ sessionService, debuggingService }));
      await api.register(patchRoutes({ patchService }));
      await api.register(verificationRoutes({ verificationService }));
      await api.register(
        dashboardRoutes({ dashboardService: createDashboardService({ db: database.db }) }),
      );
      await api.register(
        mediaRoutes({ mediaService, messageImages, webOrigin: config.env.WEB_ORIGIN }),
      );
    },
    { prefix: API_PREFIX },
  );

  return app;
}
