/**
 * Claude Provider - Executes queries using Claude Agent SDK
 *
 * Wraps the @anthropic-ai/claude-agent-sdk for seamless integration
 * with the provider architecture.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { spawn, type ChildProcess } from "child_process";
import { BaseProvider } from "./base-provider.js";
import type {
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
} from "./types.js";

/**
 * Custom spawn function to fix ENOENT errors in Electron/non-interactive shells.
 * Uses absolute path for node and avoids shell mode to preserve JSON arguments.
 */
function createCustomSpawn(options: {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}): ChildProcess {
  const { command, args, cwd, env, signal } = options;

  console.log("[ClaudeProvider] Custom spawn:", { command, argsCount: args.length, cwd });

  // Ensure PATH includes homebrew bin for child processes
  const extendedEnv = {
    ...env,
    PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:${env.PATH || ""}`,
  };

  // Spawn without shell mode to preserve JSON arguments
  const proc = spawn(command, args, {
    cwd,
    env: extendedEnv as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    // No shell mode - causes JSON argument mangling
  });

  // Log stderr for debugging
  proc.stderr?.on("data", (data) => {
    console.log("[ClaudeProvider] stderr:", data.toString().trim());
  });

  // Handle abort signal
  signal.addEventListener("abort", () => {
    proc.kill("SIGTERM");
  });

  return proc;
}

export class ClaudeProvider extends BaseProvider {
  getName(): string {
    return "claude";
  }

  /**
   * Execute a query using Claude Agent SDK
   */
  async *executeQuery(
    options: ExecuteOptions
  ): AsyncGenerator<ProviderMessage> {
    const {
      prompt,
      model,
      cwd,
      systemPrompt,
      maxTurns = 20,
      allowedTools,
      abortController,
      conversationHistory,
      sdkSessionId,
      executable,
    } = options;

    // Build Claude SDK options
    const defaultTools = [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "WebSearch",
      "WebFetch",
    ];
    const toolsToUse = allowedTools || defaultTools;

    const sdkOptions: Options = {
      model,
      systemPrompt,
      maxTurns,
      cwd,
      allowedTools: toolsToUse,
      permissionMode: "acceptEdits",
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
      },
      abortController,
      // Use symlinked path to node (not Cellar path) to fix ENOENT on non-interactive shells
      executable: executable || "/opt/homebrew/bin/node",
      // Use custom spawn with shell mode to fix ENOENT in Electron/non-interactive shells
      spawnClaudeCodeProcess: createCustomSpawn,
      // Resume existing SDK session if we have a session ID
      ...(sdkSessionId && conversationHistory && conversationHistory.length > 0
        ? { resume: sdkSessionId }
        : {}),
    };

    // Build prompt payload
    let promptPayload: string | AsyncIterable<any>;

    if (Array.isArray(prompt)) {
      // Multi-part prompt (with images)
      promptPayload = (async function* () {
        const multiPartPrompt = {
          type: "user" as const,
          session_id: "",
          message: {
            role: "user" as const,
            content: prompt,
          },
          parent_tool_use_id: null,
        };
        yield multiPartPrompt;
      })();
    } else {
      // Simple text prompt
      promptPayload = prompt;
    }

    // Execute via Claude Agent SDK
    console.log("[ClaudeProvider] SDK options:", {
      executable: sdkOptions.executable,
      cwd: sdkOptions.cwd,
      model: sdkOptions.model,
    });
    try {
      const stream = query({ prompt: promptPayload, options: sdkOptions });

      // Stream messages directly - they're already in the correct format
      for await (const msg of stream) {
        yield msg as ProviderMessage;
      }
    } catch (error) {
      console.error(
        "[ClaudeProvider] executeQuery() error during execution:",
        error
      );
      throw error;
    }
  }

  /**
   * Detect Claude SDK installation (always available via npm)
   */
  async detectInstallation(): Promise<InstallationStatus> {
    // Claude SDK is always available since it's a dependency
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    const status: InstallationStatus = {
      installed: true,
      method: "sdk",
      hasApiKey,
      authenticated: hasApiKey,
    };

    return status;
  }

  /**
   * Get available Claude models
   */
  getAvailableModels(): ModelDefinition[] {
    const models = [
      {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        modelString: "claude-opus-4-5-20251101",
        provider: "anthropic",
        description: "Most capable Claude model",
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsVision: true,
        supportsTools: true,
        tier: "premium" as const,
        default: true,
      },
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        modelString: "claude-sonnet-4-20250514",
        provider: "anthropic",
        description: "Balanced performance and cost",
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsVision: true,
        supportsTools: true,
        tier: "standard" as const,
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        modelString: "claude-3-5-sonnet-20241022",
        provider: "anthropic",
        description: "Fast and capable",
        contextWindow: 200000,
        maxOutputTokens: 8000,
        supportsVision: true,
        supportsTools: true,
        tier: "standard" as const,
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        modelString: "claude-3-5-haiku-20241022",
        provider: "anthropic",
        description: "Fastest Claude model",
        contextWindow: 200000,
        maxOutputTokens: 8000,
        supportsVision: true,
        supportsTools: true,
        tier: "basic" as const,
      },
    ] satisfies ModelDefinition[];
    return models;
  }

  /**
   * Check if the provider supports a specific feature
   */
  supportsFeature(feature: string): boolean {
    const supportedFeatures = ["tools", "text", "vision", "thinking"];
    return supportedFeatures.includes(feature);
  }
}
