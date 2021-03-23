import WebSocket from "ws";
import type { ApiParams, ApiOutput } from "mayaengine-types";
export declare const connect: (webSocketUrl: string, apiKey: string, apiSecret: string, options?: WebSocket.ClientOptions, reconnection?: boolean) => Promise<unknown>;
export declare const request: (params: ApiParams, options?: RequestOptions) => Promise<ApiOutput>;
interface RequestOptions {
    timeout?: number;
    clearPending?: boolean;
}
export declare const close: () => Promise<unknown>;
export {};
