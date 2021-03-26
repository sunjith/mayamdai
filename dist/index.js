"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.close = exports.request = exports.connect = void 0;
const debug_1 = __importDefault(require("debug"));
const ws_1 = __importDefault(require("ws"));
const debug = debug_1.default("mayamdai");
const PING_INTERVAL = 30000; // milliseconds
const RETRY_INTERVAL = 10000; // milliseconds
const REQUEST_TIMEOUT = 5000; // milliseconds
let alive = false;
let authenticated = false;
let attempts = 0;
let requestId = 0;
let ws;
let pingInterval;
const requestQueues = {};
const connect = (webSocketUrl, apiKey, apiSecret, options, reconnection = false) => new Promise((resolve, reject) => {
    if (!ws) {
        alive = false;
        authenticated = false;
        requestId = 0;
        debug("Connecting");
        ws = new ws_1.default(webSocketUrl, options);
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
                    exports.connect(webSocketUrl, apiKey, apiSecret, options, true);
                }, RETRY_INTERVAL);
            }
            else {
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
                }
                else {
                    debug("Trying to ping non-existent socket. Stop ping.");
                    clearInterval(pingInterval);
                }
            }, PING_INTERVAL);
            const auth = {
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
            if (ws) {
                ws.terminate();
                ws = null;
            }
            exports.connect(webSocketUrl, apiKey, apiSecret, options, true);
        });
        ws.on("message", (payload) => __awaiter(void 0, void 0, void 0, function* () {
            debug("Message: %O", payload);
            let output;
            try {
                output = JSON.parse(payload);
                const { requestType, requestId: id, statusCode, statusMessage, } = output;
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
                                }
                                catch (error) {
                                    debug("Message send error (%s:%d): %O", params.requestType, params.id, error);
                                    clearTimeout(timeout);
                                    promise.reject("Message send failed: " + error.getMessage());
                                    delete requestQueue[ids[j]];
                                }
                            }
                        }
                        resolve(statusMessage[0]);
                    }
                    else {
                        debug("Auth failed: %O", statusMessage);
                        yield exports.close();
                        reject(`Authentication failed: ${statusMessage[0]}`);
                    }
                }
                else {
                    if (!requestQueues[requestType] ||
                        !requestQueues[requestType][id]) {
                        debug("Stale response: %s, %s", requestType, id);
                    }
                    else {
                        const { timeout, promise } = requestQueues[requestType][id];
                        clearTimeout(timeout);
                        if (200 === statusCode) {
                            promise.resolve(output);
                        }
                        else {
                            promise.reject(`Server error (${statusCode}): ${statusMessage.join("; ")}`);
                        }
                        delete requestQueues[requestType][id];
                    }
                }
            }
            catch (error) {
                debug("Message parse error: %O", error);
            }
        }));
    }
});
exports.connect = connect;
const request = (params, options) => __awaiter(void 0, void 0, void 0, function* () {
    const { timeout = REQUEST_TIMEOUT, clearPending = false } = Object.assign({}, options);
    const id = requestId;
    const { requestType } = params;
    params.requestId = id;
    debug("Request: %s", JSON.stringify(params));
    if (clearPending && requestQueues[requestType]) {
        const ids = Object.keys(requestQueues[requestType]);
        const idsLength = ids.length;
        debug("Clear pending requests: %d", idsLength);
        for (let i = 0; i < idsLength; i++) {
            const { timeout: requestTimeout, promise: requestPromise, } = requestQueues[requestType][ids[i]];
            debug("Clear timeout: %d, %d", i, ids[i]);
            clearTimeout(requestTimeout);
            requestPromise.reject(`Request cancelled by new request: ${id}`);
        }
        requestQueues[requestType] = {};
    }
    else if (!requestQueues[requestType]) {
        requestQueues[requestType] = {};
    }
    const promise = new Promise((resolve, reject) => {
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
        }
        catch (error) {
            debug("Message send error (%s:%d): %O", requestType, id, error);
            process.nextTick(() => {
                clearTimeout(requestQueues[requestType][id].timeout);
                requestQueues[requestType][id].promise.reject("Message send failed: " + error.getMessage());
                delete requestQueues[requestType][id];
            });
        }
    }
    else {
        debug("Request queued");
    }
    requestId++;
    return promise;
});
exports.request = request;
const close = () => new Promise((resolve, _reject) => {
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
                debug("Clear timeout: (%d) %s, (%d) %s", i, requestTypes[i], j, ids[j]);
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
    }
    else {
        resolve("Closed");
    }
});
exports.close = close;
