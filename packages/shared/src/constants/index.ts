export const API_PREFIX = "/api/v1";

export const MODEL_PROVIDERS = ["meta", "baseten"] as const;
export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];
