export declare const RELEASE_ENVIRONMENTS: readonly string[];
export declare const REQUIRED_SECRETS: readonly string[];
export declare function readWranglerConfig(path?: string): Record<string, unknown>;
export declare function assertReleaseConfig(config: unknown, environment: string): Record<string, unknown>;
export declare function assertBuildTarget(
  env?: Record<string, string | undefined>,
  config?: unknown,
): Record<string, unknown> | null;
