import type {
  EvidenceResponse,
  FileContentResponse,
  FileListResponse,
  SearchResponse,
} from "@bytewise/shared";
import { discoverFiles } from "../filesystem/file-discovery";
import { readProjectFile } from "../filesystem/file-reader";
import { loadSearchableFiles, searchFiles } from "../filesystem/text-search";
import { buildEvidence } from "./context.service";
import type { ProjectService } from "./project.service";

/** Read-only access to a registered project's files. Never modifies anything. */
export function createProjectFilesService(deps: { projectService: ProjectService }) {
  const { projectService } = deps;

  async function searchable(projectId: string) {
    const root = projectService.rootFor(projectId);
    const { files } = await discoverFiles(root);
    return loadSearchableFiles(root, files);
  }

  return {
    async listFiles(projectId: string): Promise<FileListResponse> {
      return discoverFiles(projectService.rootFor(projectId));
    },

    async readFile(projectId: string, relativePath: string): Promise<FileContentResponse> {
      return readProjectFile(projectService.rootFor(projectId), relativePath);
    },

    async search(projectId: string, query: string, limit: number): Promise<SearchResponse> {
      return searchFiles(await searchable(projectId), query, limit);
    },

    async gatherEvidence(projectId: string, query: string): Promise<EvidenceResponse> {
      return buildEvidence(await searchable(projectId), query);
    },
  };
}

export type ProjectFilesService = ReturnType<typeof createProjectFilesService>;
