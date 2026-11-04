import { patchProposalSchema, type PatchProposal } from "@bytewise/shared";
import type { PatchProposalRow } from "../database/schema";
import type { BuiltPatchFile } from "./patch-builder";

/** Public view of a stored proposal. Content hashes stay server-side. */
export function toPatchDto(row: PatchProposalRow): PatchProposal {
  const files = (JSON.parse(row.filesJson) as BuiltPatchFile[]).map(
    ({ originalHash: _o, proposedHash: _p, ...file }) => file,
  );
  return patchProposalSchema.parse({ ...row, files });
}
