import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMediaConnection } from "./mediaConnection";

const state = vi.hoisted(() => ({ client: undefined as any }));
vi.mock("./client", () => ({ getClient: () => state.client }));

describe("Telegram media recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.client = {
      connected: true,
      connect: vi.fn(async () => { state.client.connected = true; }),
      _exportedSenderPromises: new Map(),
      _exportedSenderReleaseTimeouts: new Map(),
    };
  });
  afterEach(() => vi.useRealTimers());

  it("replaces a closed media connection while preserving the healthy main connection", async () => {
    const closed = { isConnected: () => false, userDisconnected: true, disconnect: vi.fn(async () => {}) };
    const healthy = { isConnected: () => true, userDisconnected: false, disconnect: vi.fn(async () => {}) };
    state.client._exportedSenderPromises.set(1, Promise.resolve(closed));
    state.client._exportedSenderPromises.set(2, Promise.resolve(healthy));
    state.client._exportedSenderReleaseTimeouts.set(1, setTimeout(() => {}, 60_000));
    await withMediaConnection(async () => {
      expect(state.client._exportedSenderPromises.has(1)).toBe(false);
      expect(state.client._exportedSenderPromises.has(2)).toBe(true);
    });
    expect(closed.disconnect).toHaveBeenCalledOnce();
    expect(healthy.disconnect).not.toHaveBeenCalled();
    expect(state.client.connect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a media connection that closes during a download", async () => {
    const closed = { isConnected: () => false, userDisconnected: true, disconnect: vi.fn(async () => {}) };
    const operation = vi.fn().mockImplementationOnce(async () => {
      state.client._exportedSenderPromises.set(1, Promise.resolve(closed));
      throw new Error("Cannot send requests while disconnected. Please reconnect.");
    }).mockImplementationOnce(async () => {
      expect(state.client._exportedSenderPromises.has(1)).toBe(false);
      return "video";
    });
    const result = withMediaConnection(operation);
    await vi.runAllTimersAsync();
    expect(await result).toBe("video");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("refetches media after an expired Telegram file reference", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("FILE_REFERENCE_EXPIRED")).mockResolvedValueOnce("fresh");
    const result = withMediaConnection(operation);
    await vi.runAllTimersAsync();
    expect(await result).toBe("fresh");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry a missing or deleted original", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("MESSAGE_ID_INVALID"));
    await expect(withMediaConnection(operation)).rejects.toThrow("MESSAGE_ID_INVALID");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("reconnects the main client before downloading", async () => {
    state.client.connected = false;
    await withMediaConnection(async () => expect(state.client.connected).toBe(true));
    expect(state.client.connect).toHaveBeenCalledOnce();
  });
});
