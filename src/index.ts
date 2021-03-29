import nodeDebug from "debug";
import WebSocket from "ws";
import axios from "axios";
import type { ApiParams, ApiOutput } from "mayaengine-types";
import type { AxiosRequestConfig } from "axios";

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
let httpMode: boolean;
let httpModeConfig: HttpModeConfig;
const requestQueues: RequestQueues = {};

interface HttpModeConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

interface RequestQueues {
  [type: string]: RequestQueue;
}

interface RequestQueue {
  [id: string]: QueueEntry;
}

interface QueueEntry {
  params: ApiParams;
  promise: ResolveReject;
  timeout?: NodeJS.Timeout; // only for WebSocket
}

interface ResolveReject {
  resolve: (value: ApiOutput | PromiseLike<ApiOutput>) => void;
  reject: (reason?: any) => void;
}

export const connect: (
  apiUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: WebSocket.ClientOptions // only for WebSocket
) => Promise<string> = (
  apiUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: WebSocket.ClientOptions
) => doConnect(apiUrl, apiKey, apiSecret, options);

const doConnect: (
  apiUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: WebSocket.ClientOptions, // only for WebSocket
  reconnection?: boolean // only for WebSocket
) => Promise<string> = (
  apiUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: WebSocket.ClientOptions,
  reconnection = false
) => {
  if ("http" === apiUrl.slice(0, 4)) {
    httpMode = true;
    httpModeConfig = {
      apiUrl,
      apiKey,
      apiSecret,
    };
    return new Promise((resolve, reject) => {
      axios
        .post(
          apiUrl,
          { apiKey, apiSecret, requestId, requestType: "noop" },
          { timeout: REQUEST_TIMEOUT }
        )
        .then((response) => {
          const { statusCode, statusMessage } = response.data;
          if (200 === response.status) {
            if (200 === statusCode) {
              requestId++;
              resolve("Connected");
            } else {
              reject(
                `Server error (${statusCode}): ${statusMessage.join("; ")}`
              );
            }
          } else {
            reject(`HTTP error (${response.status}): ${response.statusText}`);
          }
        })
        .catch((error) => {
          reject("Request send failed: " + error.getMessage());
        });
    });
  } else {
    httpMode = false;
  }

  return new Promise((resolve, reject) => {
    if (!ws) {
      debug("Connecting");
      ws = new WebSocket(apiUrl, options);

      ws.on("error", (error) => {
        debug("Error (%d): %O", attempts, error);
        if (0 === ws.readyState) {
          attempts++;
        }
        clearInterval(pingInterval);
        if (ws) {
          ws.terminate();
          ws = null;
        }
        if (reconnection) {
          setTimeout(() => {
            doConnect(apiUrl, apiKey, apiSecret, options, true);
          }, RETRY_INTERVAL);
        } else {
          reject(`Error: ${error.message}`);
        }
      });

      ws.on("open", () => {
        debug("Connected");
        alive = true;
        attempts = 0;
        pingInterval = setInterval(() => {
          if (ws) {
            ws.ping();
          } else {
            debug("Trying to ping non-existent socket. Stop ping.");
            clearInterval(pingInterval);
          }
        }, PING_INTERVAL);
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
        alive = false;
        authenticated = false;
        clearInterval(pingInterval);
        debug("Disconnected");
        if (ws) {
          ws.terminate();
          ws = null;
        }
        doConnect(apiUrl, apiKey, apiSecret, options, true);
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
                      params.requestId,
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
};

export const request = async (params: ApiParams, options?: RequestOptions) => {
  if (httpMode) {
    return requestHttp(params, httpModeConfig.apiUrl, options);
  }

  const { timeout = REQUEST_TIMEOUT, cancelPending = false } = { ...options };
  const id = requestId;
  const { requestType } = params;
  params.requestId = id;

  debug("Request: %s", JSON.stringify(params));
  if (cancelPending && requestQueues[requestType]) {
    const ids = Object.keys(requestQueues[requestType]);
    const idsLength = ids.length;
    debug("Cancel pending requests: %d", idsLength);
    for (let i = 0; i < idsLength; i++) {
      const {
        timeout: requestTimeout,
        promise: requestPromise,
      } = requestQueues[requestType][ids[i]];
      debug("Clear timeout: %d, %d", i, ids[i]);
      clearTimeout(requestTimeout);
      requestPromise.reject(
        `Request (${requestType}:${ids[i]}) cancelled by new request: ${id}`
      );
    }
    requestQueues[requestType] = {};
  } else if (!requestQueues[requestType]) {
    requestQueues[requestType] = {};
  }
  const promise = new Promise<ApiOutput>((resolve, reject) => {
    requestQueues[requestType][id] = {
      params,
      promise: { resolve, reject },
      timeout: setTimeout(() => {
        delete requestQueues[requestType][id];
        reject(`Request timed out: ${id}, ${requestType}`);
      }, timeout),
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
  cancelPending?: boolean;
}

export const requestHttp = async (
  params: ApiParams,
  apiUrl: string,
  options?: RequestOptions
) => {
  const { timeout = REQUEST_TIMEOUT, cancelPending = false } = { ...options };
  const id = requestId;
  const { requestType } = params;
  params.requestId = id;

  if (cancelPending && requestQueues[requestType]) {
    const ids = Object.keys(requestQueues[requestType]);
    const idsLength = ids.length;
    debug("Cancel pending requests: %d", idsLength);
    for (let i = 0; i < idsLength; i++) {
      requestQueues[requestType][ids[i]].promise.reject(
        `Request (${requestType}:${ids[i]}) cancelled by new request: ${id}`
      );
    }
    requestQueues[requestType] = {};
  } else if (!requestQueues[requestType]) {
    requestQueues[requestType] = {};
  }
  const promise = new Promise<ApiOutput>((resolve, reject) => {
    requestQueues[requestType][id] = {
      params,
      promise: { resolve, reject },
    };
    const requestConfig: AxiosRequestConfig = { timeout };
    if (!params.apiKey && httpModeConfig) {
      const { apiKey, apiSecret } = httpModeConfig;
      params.apiKey = apiKey;
      params.apiSecret = apiSecret;
    }
    axios
      .post(apiUrl, params, requestConfig)
      .then((response) => {
        const {
          requestType: type,
          requestId: rid,
          statusCode,
          statusMessage,
        } = response.data;
        const { promise: requestPromise } = requestQueues[type][rid];
        if (200 === response.status) {
          if (200 === statusCode) {
            requestPromise.resolve(response.data);
          } else {
            requestPromise.reject(
              `Server error (${statusCode}): ${statusMessage.join("; ")}`
            );
          }
        } else {
          requestPromise.reject(
            `HTTP error (${response.status}): ${response.statusText}`
          );
        }
        delete requestQueues[type][rid];
      })
      .catch((error) => {
        debug("Request send error (%s:%d): %O", requestType, id, error);
        reject("Request send failed: " + error.getMessage());
      });
  });
  requestId++;
  return promise;
};

export const close: () => Promise<string> = () => {
  requestId = 0;
  alive = false;
  authenticated = false;

  if (httpMode) {
    httpModeConfig = null;
    return Promise.resolve("Closed");
  }

  return new Promise((resolve, _reject) => {
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
        if (ws) {
          ws.terminate();
          ws = null;
        }
        resolve("Closed");
      });
      ws.close();
    } else {
      resolve("Closed");
    }
  });
};
