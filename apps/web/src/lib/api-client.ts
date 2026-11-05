import type { z } from "zod";
import {
  API_PREFIX,
  apiErrorSchema,
  dashboardSummarySchema,
  availableProjectsResponseSchema,
  debugSessionSchema,
  evidenceResponseSchema,
  fileContentResponseSchema,
  fileListResponseSchema,
  healthResponseSchema,
  importProjectResponseSchema,
  patchProposalSchema,
  projectListResponseSchema,
  projectSchema,
  searchResponseSchema,
  sessionDetailSchema,
  screenshotSchema,
  sessionListResponseSchema,
  testOutcomesSchema,
  transcriptionResponseSchema,
  verificationRunSchema,
  type CreateProjectRequest,
  type CreateScreenshotRequest,
  type ImportProjectRequest,
  type PostMessageRequest,
} from "@bytewise/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** The only place the web app talks to the backend. Every response is validated. */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method?: string; body?: unknown; binary?: ArrayBuffer },
): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (init?.binary) headers["Content-Type"] = "application/octet-stream";
  else if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    res = await fetch(`${API_URL}${API_PREFIX}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.binary ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "network_error", `Cannot reach the Bytewise server at ${API_URL}.`);
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiClientError(res.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiClientError(res.status, "http_error", `Request failed with status ${res.status}.`);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError(
      res.status,
      "invalid_response",
      "The server returned unexpected data.",
    );
  }
  return parsed.data;
}

export const api = {
  health: () => request("/health", healthResponseSchema),
  listProjects: () => request("/projects", projectListResponseSchema),
  getProject: (id: string) => request(`/projects/${encodeURIComponent(id)}`, projectSchema),
  createProject: (body: CreateProjectRequest) =>
    request("/projects", projectSchema, { method: "POST", body }),
  listAvailableProjects: () => request("/projects/available", availableProjectsResponseSchema),
  importProject: (body: ImportProjectRequest) =>
    request("/projects/import", importProjectResponseSchema, { method: "POST", body }),

  listFiles: (projectId: string) =>
    request(`/projects/${encodeURIComponent(projectId)}/files`, fileListResponseSchema),
  readFile: (projectId: string, path: string) =>
    request(
      `/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(path)}`,
      fileContentResponseSchema,
    ),
  search: (projectId: string, q: string) =>
    request(
      `/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(q)}`,
      searchResponseSchema,
    ),
  gatherEvidence: (projectId: string, query: string) =>
    request(`/projects/${encodeURIComponent(projectId)}/evidence`, evidenceResponseSchema, {
      method: "POST",
      body: { query },
    }),

  listSessions: () => request("/sessions", sessionListResponseSchema),
  createSession: (projectId: string) =>
    request(`/projects/${encodeURIComponent(projectId)}/sessions`, debugSessionSchema, {
      method: "POST",
      body: {},
    }),
  getSession: (sessionId: string) =>
    request(`/sessions/${encodeURIComponent(sessionId)}`, sessionDetailSchema),
  postMessage: (sessionId: string, content: string, images: PostMessageRequest["images"] = []) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/messages`, sessionDetailSchema, {
      method: "POST",
      body: images.length ? { content, images } : { content },
    }),
  retryDiagnosis: (sessionId: string) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/diagnose`, sessionDetailSchema, {
      method: "POST",
    }),

  proposePatch: (sessionId: string) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/patch-proposals`, patchProposalSchema, {
      method: "POST",
    }),
  approvePatch: (patchId: string) =>
    request(`/patches/${encodeURIComponent(patchId)}/approve`, patchProposalSchema, {
      method: "POST",
    }),
  rejectPatch: (patchId: string) =>
    request(`/patches/${encodeURIComponent(patchId)}/reject`, patchProposalSchema, {
      method: "POST",
    }),
  revertPatch: (patchId: string) =>
    request(`/patches/${encodeURIComponent(patchId)}/revert`, patchProposalSchema, {
      method: "POST",
    }),

  startVerification: (sessionId: string, script: string) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/verifications`, verificationRunSchema, {
      method: "POST",
      body: { script },
    }),

  dashboardSummary: () => request("/dashboard/summary", dashboardSummarySchema),
  testOutcomes: (days: number) =>
    request(
      `/dashboard/test-outcomes?days=${days}&tzOffsetMinutes=${-new Date().getTimezoneOffset()}`,
      testOutcomesSchema,
    ),

  /** Raw PCM16 24 kHz mono audio. The text comes back for the developer to edit. */
  transcribe: (pcm: ArrayBuffer) =>
    request("/transcriptions", transcriptionResponseSchema, { method: "POST", binary: pcm }),
  uploadScreenshot: (sessionId: string, body: CreateScreenshotRequest) =>
    request(`/sessions/${encodeURIComponent(sessionId)}/screenshots`, screenshotSchema, {
      method: "POST",
      body,
    }),
};

export const messageImageUrl = (imageId: string) =>
  `${API_URL}${API_PREFIX}/message-images/${encodeURIComponent(imageId)}/image`;

/** WebSocket for live dictation; audio goes to the server, which holds the Meta key. */
export const liveTranscriptionUrl = () =>
  `${API_URL.replace(/^http/, "ws")}${API_PREFIX}/transcriptions/live`;

export const screenshotImageUrl = (screenshotId: string) =>
  `${API_URL}${API_PREFIX}/screenshots/${encodeURIComponent(screenshotId)}/image`;
