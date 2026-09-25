export type DeploymentTarget = "docker" | "fnos";

export interface DeploymentRuntime {
  target: DeploymentTarget;
  gatewayPrefix: string;
  gatewaySocket: string;
}

export function resolveDeploymentRuntime(environment: NodeJS.ProcessEnv = process.env): DeploymentRuntime {
  const configuredTarget = (environment.BRIDGE_RUNTIME ?? "docker").trim().toLowerCase();
  if (configuredTarget !== "docker" && configuredTarget !== "fnos") {
    throw new Error("BRIDGE_RUNTIME must be either docker or fnos");
  }

  if (configuredTarget === "docker") {
    return { target: "docker", gatewayPrefix: "", gatewaySocket: "" };
  }

  const gatewayPrefix = (environment.BRIDGE_GATEWAY_PREFIX ?? "").trim();
  const gatewaySocket = (environment.BRIDGE_GATEWAY_SOCKET ?? "").trim();
  if (!gatewayPrefix || !gatewaySocket) {
    throw new Error("fnos mode requires BRIDGE_GATEWAY_PREFIX and BRIDGE_GATEWAY_SOCKET");
  }
  return { target: "fnos", gatewayPrefix, gatewaySocket };
}
