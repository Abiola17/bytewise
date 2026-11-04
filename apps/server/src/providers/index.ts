import type { AppConfig } from "../config/env";
import { createBasetenProvider } from "./baseten/baseten.provider";
import { createMetaProvider } from "./meta/meta.provider";
import type { ModelProvider } from "./model-provider";

export function createModelProvider(config: AppConfig): ModelProvider {
  switch (config.modelProvider.name) {
    case "meta":
      return createMetaProvider(config);
    case "baseten":
      return createBasetenProvider(config);
  }
}
