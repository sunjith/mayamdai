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
exports.close = exports.requestHttp = exports.request = exports.connect = void 0;
const events_1 = require("events");
const debug_1 = __importDefault(require("debug"));
const ws_1 = __importDefault(require("ws"));
const axios_1 = __importDefault(require("axios"));
const debug = (0, debug_1.default)("mayamdai");
const PING_INTERVAL = 30000; // milliseconds
const RETRY_INTERVAL = 10000; // milliseconds
const REQUEST_TIMEOUT = 5000; // milliseconds
const mayamdai = new events_1.EventEmitter();
const requestQueues = {};
let alive = false;
let authenticated = false;
let attempts = 0;
let requestId = 0;
let ws;
let pingInterval;
let httpMode;
let httpModeConfig;
const connect = (apiUrl, apiKey, apiSecret, options) => doConnect(apiUrl, apiKey, apiSecret, options);
exports.connect = connect;
const doConnect = (apiUrl, apiKey, apiSecret, options, reconnection = false) => {
    if ("http" === apiUrl.slice(0, 4)) {
        httpMode = true;
        httpModeConfig = {
            apiUrl,
            apiKey,
            apiSecret,
        };
        return new Promise((resolve, reject) => {
            axios_1.default
                .post(apiUrl, { apiKey, apiSecret, requestId, requestType: "noop" }, { timeout: REQUEST_TIMEOUT })
                .then((response) => {
                if (200 === response.status) {
                    const { statusCode, statusMessage } = response.data;
                    if (200 === statusCode) {
                        requestId++;
                        debug("Connected");
                        resolve(mayamdai);
                    }
                    else {
                        reject(`Server error (${statusCode}): ${statusMessage.join("; ")}`);
                    }
                }
                else {
                    reject(`HTTP error (${response.status}): ${response.statusText}`);
                }
            })
                .catch((error) => {
                reject("Request send failed: " + error.getMessage());
            });
        });
    }
    else {
        httpMode = false;
    }
    return new Promise((resolve, reject) => {
        if (!ws) {
            debug("Connecting");
            ws = new ws_1.default(apiUrl, options);
            ws.on("error", (error) => {
                mayamdai.emit("socketError", error);
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
                }
                else {
                    reject(`Error: ${error.message}`);
                }
            });
            ws.on("open", () => {
                mayamdai.emit("socketOpen");
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
                mayamdai.emit("socketClose");
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
            ws.on("message", (payload) => __awaiter(void 0, void 0, void 0, function* () {
                debug("Message: %O", payload);
                let output;
                try {
                    output = JSON.parse(payload);
                    const { requestType, partType, requestId: id, statusCode, statusMessage, } = output;
                    if ("auth" === requestType) {
                        debug("Auth response: %s, %s", requestType, id);
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
                                        debug("Message send error (%s:%d): %O", params.requestType, params.requestId, error);
                                        clearTimeout(timeout);
                                        promise.reject("Message send failed: " + error);
                                        delete requestQueue[ids[j]];
                                    }
                                }
                            }
                            debug(statusMessage[0]);
                            resolve(mayamdai);
                        }
                        else {
                            debug("Auth failed: %O", statusMessage);
                            yield (0, exports.close)();
                            reject(`Authentication failed: ${statusMessage[0]}`);
                        }
                    }
                    else {
                        if (!requestQueues[requestType] ||
                            !requestQueues[requestType][id]) {
                            if (partType) {
                                debug("Additional partial response: %s, %s, %s", requestType, id, partType);
                                // Emit as event
                                mayamdai.emit("partial", output);
                            }
                            else {
                                debug("Stale response: %s, %s", requestType, id);
                                // Ignore
                            }
                        }
                        else {
                            debug("Valid first response: %s, %s", requestType, id);
                            // Resolve/reject the promise
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
};
const request = (params, options) => __awaiter(void 0, void 0, void 0, function* () {
    if (httpMode) {
        return (0, exports.requestHttp)(params, httpModeConfig.apiUrl, options);
    }
    const { timeout = REQUEST_TIMEOUT, cancelPending = false } = Object.assign({}, options);
    const id = requestId;
    const { requestType } = params;
    params.requestId = id;
    debug("Request: %s", JSON.stringify(params));
    if (cancelPending && requestQueues[requestType]) {
        const ids = Object.keys(requestQueues[requestType]);
        const idsLength = ids.length;
        debug("Cancel pending requests: %d", idsLength);
        for (let i = 0; i < idsLength; i++) {
            const { timeout: requestTimeout, promise: requestPromise } = requestQueues[requestType][ids[i]];
            debug("Clear timeout: %d, %d", i, ids[i]);
            clearTimeout(requestTimeout);
            requestPromise.reject(`Request (${requestType}:${ids[i]}) cancelled by new request: ${id}`);
        }
        requestQueues[requestType] = {};
    }
    else if (!requestQueues[requestType]) {
        requestQueues[requestType] = {};
    }
    const promise = new Promise((resolve, reject) => {
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
        }
        catch (error) {
            debug("Message send error (%s:%d): %O", requestType, id, error);
            process.nextTick(() => {
                clearTimeout(requestQueues[requestType][id].timeout);
                requestQueues[requestType][id].promise.reject("Message send failed: " + error);
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
const requestHttp = (params, apiUrl, options) => __awaiter(void 0, void 0, void 0, function* () {
    const { timeout = REQUEST_TIMEOUT, cancelPending = false } = options;
    const id = requestId;
    const { requestType } = params;
    params.requestId = id;
    if (cancelPending && requestQueues[requestType]) {
        const ids = Object.keys(requestQueues[requestType]);
        const idsLength = ids.length;
        debug("Cancel pending requests: %d", idsLength);
        for (let i = 0; i < idsLength; i++) {
            requestQueues[requestType][ids[i]].promise.reject(`Request (${requestType}:${ids[i]}) cancelled by new request: ${id}`);
        }
        requestQueues[requestType] = {};
    }
    else if (!requestQueues[requestType]) {
        requestQueues[requestType] = {};
    }
    const promise = new Promise((resolve, reject) => {
        requestQueues[requestType][id] = {
            params,
            promise: { resolve, reject },
        };
        const requestConfig = { timeout };
        if (!params.apiKey && httpModeConfig) {
            const { apiKey, apiSecret } = httpModeConfig;
            params.apiKey = apiKey;
            params.apiSecret = apiSecret;
        }
        axios_1.default
            .post(apiUrl, params, requestConfig)
            .then((response) => {
            const { requestType: type, requestId: rid, statusCode, statusMessage, } = response.data;
            const { promise: requestPromise } = requestQueues[type][rid];
            if (200 === response.status) {
                if (200 === statusCode) {
                    requestPromise.resolve(response.data);
                }
                else {
                    requestPromise.reject(`Server error (${statusCode}): ${statusMessage.join("; ")}`);
                }
            }
            else {
                requestPromise.reject(`HTTP error (${response.status}): ${response.statusText}`);
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
});
exports.requestHttp = requestHttp;
const close = () => {
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
                mayamdai.emit("socketClose");
                mayamdai.removeAllListeners();
                resolve("Closed");
            });
            ws.close();
        }
        else {
            resolve("Closed");
        }
    });
};
exports.close = close;
