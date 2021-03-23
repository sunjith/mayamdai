import nodeDebug from "debug";
import WebSocket from "ws";
import type { ApiParams, ApiOutput } from "mayaengine-types";

const debug = nodeDebug("mayamdai");

const PING_INTERVAL = 30000; // milliseconds
const RETRY_INTERVAL = 10000; // milliseconds
const REQUEST_TIMEOUT = 5000; // milliseconds

let alive = false;
let authenticated = false;
let attempts = 0;
let requestId = 0;
let ws: WebSocket;
let pingInterval: NodeJS.Timeout;
const requestQueues: RequestQueues = {};

interface RequestQueues {
  [type: string]: RequestQueue;
}

interface RequestQueue {
  [id: string]: QueueEntry;
}

interface QueueEntry {
  timeout: NodeJS.Timeout;
  params: ApiParams;
  promise: ResolveReject;
}

interface ResolveReject {
  resolve: (value: ApiOutput | PromiseLike<ApiOutput>) => void;
  reject: (reason?: any) => void;
}

export const connect = (
  webSocketUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: WebSocket.ClientOptions,
  reconnection = false
) =>
  new Promise((resolve, reject) => {
    if (!ws) {
      alive = false;
      authenticated = false;
      requestId = 0;
      debug("Connecting");
      ws = new WebSocket(webSocketUrl, options);

      ws.on("error", (error) => {
        debug("Error (%d): %O", attempts, error);
        if (0 === ws.readyState) {
          attempts++;
        }
        clearInterval(pingInterval);
        ws.terminate();
        ws = null;
        if (reconnection) {
          setTimeout(() => {
            connect(webSocketUrl, apiKey, apiSecret, options, true);
          }, RETRY_INTERVAL);
        } else {
          reject(`Error: ${error.message}`);
        }
      });

      ws.on("open", () => {
        debug("Connected");
        alive = true;
        attempts = 0;
        pingInterval = setInterval(() => ws && ws.ping, PING_INTERVAL);
        const auth: ApiParams = {
          requestType: "auth",
          requestId,
          apiKey,
          apiSecret,
        };
        requestId++;
        ws.send(JSON.stringify(auth));
      });

      ws.on("pong", () => {
        debug("Pong");
        alive = true;
      });

      ws.on("close", () => {
        clearInterval(pingInterval);
        debug("Disconnected");
        ws.terminate();
        ws = null;
        connect(webSocketUrl, apiKey, apiSecret, options, true);
      });

      ws.on("message", async (payload: string) => {
        debug("Message: %O", payload);
        let output: ApiOutput;
        try {
          output = JSON.parse(payload);
          const {
            requestType,
            requestId: id,
            statusCode,
            statusMessage,
          } = output;
          if ("auth" === requestType) {
            if (200 === statusCode) {
              authenticated = true;
              // Send all queued requests
              const requestTypes = Object.keys(requestQueues);
              const typesLength = requestTypes.length;
              for (let i = 0; i < typesLength; i++) {
                const requestQueue = requestQueues[requestTypes[i]];
                const ids = Object.keys(requestQueue);
                const idsLength = ids.length;
                for (let j = 0; j < idsLength; j++) {
                  const { params, timeout, promise } = requestQueue[ids[j]];
                  try {
                    ws.send(JSON.stringify(params));
                  } catch (error) {
                    debug(
                      "Message send error (%s:%d): %O",
                      params.requestType,
                      params.id,
                      error
                    );
                    clearTimeout(timeout);
                    promise.reject(
                      "Message send failed: " + error.getMessage()
                    );
                    delete requestQueue[ids[j]];
                  }
                }
              }
              resolve(statusMessage[0]);
            } else {
              debug("Auth failed: %O", statusMessage);
              await close();
              reject(`Authentication failed: ${statusMessage[0]}`);
            }
          } else {
            if (
              !requestQueues[requestType] ||
              !requestQueues[requestType][id]
            ) {
              debug("Stale response: %s, %s", requestType, id);
            } else {
              const { timeout, promise } = requestQueues[requestType][id];
              clearTimeout(timeout);
              if (200 === statusCode) {
                promise.resolve(output);
              } else {
                promise.reject(
                  `Server error (${statusCode}): ${statusMessage.join("; ")}`
                );
              }
              delete requestQueues[requestType][id];
            }
          }
        } catch (error) {
          debug("Message parse error: %O", error);
        }
      });
    }
  });

export const request = async (params: ApiParams, options?: RequestOptions) => {
  const { timeout = REQUEST_TIMEOUT, clearPending = false } = { ...options };
  const id = requestId;
  const { requestType } = params;
  params.requestId = id;

  debug("Request: %s", requestType);
  if (clearPending && requestQueues[requestType]) {
    const ids = Object.keys(requestQueues[requestType]);
    const idsLength = ids.length;
    debug("Clear pending requests: %d", idsLength);
    for (let i = 0; i < idsLength; i++) {
      const {
        timeout: requestTimeout,
        promise: requestPromise,
      } = requestQueues[requestType][ids[i]];
      debug("Clear timeout: %d, %d", i, ids[i]);
      clearTimeout(requestTimeout);
      requestPromise.reject(`Request cancelled by new request: ${id}`);
    }
    requestQueues[requestType] = {};
  } else if (!requestQueues[requestType]) {
    requestQueues[requestType] = {};
  }
  const promise = new Promise<ApiOutput>((resolve, reject) => {
    requestQueues[requestType][id] = {
      timeout: setTimeout(() => {
        delete requestQueues[requestType][id];
        reject(`Request timed out: ${id}, ${requestType}`);
      }, timeout),
      params,
      promise: { resolve, reject },
    };
  });
  if (alive && authenticated) {
    try {
      ws.send(JSON.stringify(params));
    } catch (error) {
      debug("Message send error (%s:%d): %O", requestType, id, error);
      process.nextTick(() => {
        clearTimeout(requestQueues[requestType][id].timeout);
        requestQueues[requestType][id].promise.reject(
          "Message send failed: " + error.getMessage()
        );
        delete requestQueues[requestType][id];
      });
    }
  } else {
    debug("Request queued");
  }
  requestId++;
  return promise;
};

interface RequestOptions {
  timeout?: number;
  clearPending?: boolean;
}

export const close = () =>
  new Promise((resolve, _reject) => {
    if (ws) {
      debug("Closing");
      // Stop ping
      clearInterval(pingInterval);
      // Clear the request queues
      const requestTypes = Object.keys(requestQueues);
      const typesLength = requestTypes.length;
      for (let i = 0; i < typesLength; i++) {
        const requestQueue = requestQueues[requestTypes[i]];
        const ids = Object.keys(requestQueue);
        const idsLength = ids.length;
        for (let j = 0; j < idsLength; j++) {
          const { timeout, promise } = requestQueue[ids[j]];
          debug(
            "Clear timeout: (%d) %s, (%d) %s",
            i,
            requestTypes[i],
            j,
            ids[j]
          );
          clearTimeout(timeout);
          promise.reject("Closing connection");
        }
        delete requestQueues[requestTypes[i]];
      }
      ws.removeAllListeners();
      ws.on("close", () => {
        debug("Closed");
        ws.terminate();
        ws = null;
        resolve("Closed");
      });
      ws.close();
    } else {
      resolve("Closed");
    }
  });
