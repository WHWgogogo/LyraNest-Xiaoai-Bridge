import type { BridgeState } from "../index.js";
import type { XiaomiTokens } from "../types.js";
import { isMinaAuthenticationError } from "./mina-client.js";

export class XiaomiSessionUnavailableError extends Error {
  constructor(message = "Xiaomi authorization is unavailable; sign in again") {
    super(message);
    this.name = "XiaomiSessionUnavailableError";
  }
}

/**
 * Replays one MiNA operation after a fresh micoapi exchange when the server
 * rejects an otherwise persisted Xiaomi session.
 */
export async function withXiaomiSession<T>(
  state: BridgeState,
  operation: (tokens: XiaomiTokens) => Promise<T>,
): Promise<T> {
  const initial = state.xiaomiTokens;
  if (!initial) throw new XiaomiSessionUnavailableError();
  try {
    return await operation(initial);
  } catch (error) {
    if (!isMinaAuthenticationError(error)) throw error;
    const refreshed = await state.xiaomiLogin.recoverAuthentication();
    if (!refreshed) {
      throw new XiaomiSessionUnavailableError(state.xiaomiLogin.getStatus().message);
    }
    return operation(refreshed);
  }
}
