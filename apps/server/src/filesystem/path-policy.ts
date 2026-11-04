// The path policy is shared with the VS Code extension, so both apply the same rules.
export {
  checkRelativePath,
  isBinaryPath,
  isExcludedDirectory,
  isSensitiveFile,
  languageForPath,
  type PathCheck,
} from "@bytewise/shared";
