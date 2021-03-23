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

export const init = (
  webSocketUrl: string,
  apiKey: string,
  apiSecret: string,
  options?: WebSocket.ClientOptions
) => {
  if (!ws) {
    debug("Connecting");
    ws = new WebSocket(webSocketUrl, options);

    ws.on("error", (error) => {
      debug("Error (%d): %O", attempts, error);
      if (0 === ws.readyState) {
        attempts++;
      }
      authenticated = false;
      requestId = 0;
      ws.terminate();
      ws = null;
      setTimeout(() => {
        init(webSocketUrl, apiKey, apiSecret, options);
      }, RETRY_INTERVAL);
    });

    ws.on("open", () => {
      debug("Connected");
      alive = true;
      attempts = 0;
      pingInterval = setInterval(() => ws.ping, PING_INTERVAL);
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
      alive = false;
      authenticated = false;
      requestId = 0;
      debug("Disconnected");
      ws.terminate();
      ws = null;
      init(webSocketUrl, apiKey, apiSecret, options);
    });

    ws.on("message", (payload: string) => {
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
                  promise.reject("Message send failed: " + error.getMessage());
                  delete requestQueue[ids[j]];
                }
              }
            }
          } else {
            debug("Auth failed: %O", statusMessage);
          }
        } else {
          if (!requestQueues[requestType] || !requestQueues[requestType][id]) {
            debug("Stale response: %s, %s", requestType, id);
          } else {
            const { timeout, promise } = requestQueues[requestType][id];
            clearTimeout(timeout);
            if (200 === statusCode) {
              promise.resolve(output);
            } else {
              promise.reject(`Server error (${statusCode}): ${statusMessage}`);
            }
            delete requestQueues[requestType][id];
          }
        }
      } catch (error) {
        debug("Message parse error: %O", error);
      }
    });
  }
};

export const request = async (params: ApiParams, options: RequestOptions) => {
  const { timeout = REQUEST_TIMEOUT, clearPending = false } = options;
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
